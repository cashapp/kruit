import { KubeConfig, V1Container, V1Pod } from "@kubernetes/client-node"
import { EventEmitter } from "events"
import * as vis from "vis"
import { PodWrapper } from "./kubernetes/pod_wrapper"
import { IWatchable, IWatcher, WatchableEvents } from "./kubernetes/watcher"
import { Tabs } from "./widgets"

export abstract class Komponent extends EventEmitter {}

export class PodView extends Komponent {

    private tabs = new Tabs(this.container)

    constructor(private kubeConfig: KubeConfig, private pod: V1Pod, private container: HTMLDivElement) {
        super()
        const logTab = this.tabs.addTab(`${pod!.metadata!.name} logs`)
        const wrappedProd = new PodWrapper(this.kubeConfig, pod!)
        wrappedProd.followLogs().then((stream) => {
            stream.on("data", (line) => {
                logTab.addText(line + "\n")
            })

            // when the tab goes away the stream should stop writing to it
            logTab.on("destroy", () => {
                stream.destroy()
            })
        }).catch((err) => {
            console.log(err)
        })
    }

    public destroy() {
        this.tabs.destroy()
    }
}

export type Filter<T> = (resource: T) => boolean
export type Indentifer<T> = (resource: T) => string
export type OnChange<T> = (event: WatchableEvents, resource: T, visNode: vis.Node, visEdge: vis.Edge) => void
export type WatcherViewEvent = "selected" | "back"

export interface IWatcherView<T> {
    on(event: "selected", listener: (resource: T) => void): void
    on(event: "back", listener: () => void): void
}

export class WatcherView<T extends IWatchable> extends Komponent {
    protected rootColour = "#f7da00"
    protected visNetworkNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    protected visNetworkEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])
    protected visNetwork = new vis.Network(this.container, { nodes: this.visNetworkNodes, edges: this.visNetworkEdges}, {
        layout: {
            improvedLayout: true,
        },
    })

    constructor(private container: HTMLDivElement, private centerNodeId: string,
                private watcher: IWatcher<T>,
                private filter: Filter<T>,
                private identifier: Indentifer<T>,
                private OnChangeHook: OnChange<T>) {
            super()
            this.visNetworkNodes.add({id: centerNodeId, label: centerNodeId, color: this.rootColour })
            this.visNetwork.redraw()

            const resources = Array.from(this.watcher.getCached().values()).filter(filter)
            resources.forEach((resource) => {
                const nodeID = this.identifier(resource) as string
                const visNode: vis.Node = { id: nodeID, label: nodeID, shape: "box" }
                const visEdge: vis.Edge = { to: centerNodeId, from: nodeID, length: 100 + Math.floor(Math.random() * Math.floor(400)) }
                this.OnChangeHook("ADDED", resource, visNode, visEdge)
                this.visNetworkNodes.add(visNode)
                this.visNetworkEdges.add(visEdge)
                this.visNetwork.redraw()
            })

            this.visNetwork.on("selectNode", (params) => {
                const selectedNetworkNodeId = this.visNetwork.getNodeAt(params.pointer.DOM) as string
                if (selectedNetworkNodeId === this.centerNodeId) {
                    this.emit("back")
                } else {
                    this.emit("selected", this.watcher.getCached().get(selectedNetworkNodeId))
                }
            })

            this.registerListeners()
    }

    public destroy() {
        this.unregisterListeners()
        this.removeAllListeners()
    }


    private registerListeners() {
        this.watcher.on("ADDED", this.onAdded.bind(this))
        this.watcher.on("MODIFIED", this.onModified.bind(this))
        this.watcher.on("DELETED", this.onDeleted.bind(this))
    }

    private unregisterListeners() {
        this.watcher.removeListener("ADDED", this.onAdded)
        this.watcher.removeListener("MODIFIED", this.onModified)
        this.watcher.removeListener("DELETED", this.onDeleted)
    }

    private onAdded(resource: T) {
        const nodeID = this.identifier(resource) as string
        const visNode: vis.Node = { id: nodeID, label: nodeID, shape: "box" }
        const visEdge: vis.Edge = { to: this.centerNodeId, from: nodeID }
        this.OnChangeHook("ADDED", resource, visNode, visEdge)
        this.visNetworkNodes.add(visNode)
        this.visNetworkEdges.add(visEdge)
        this.visNetwork.redraw()
    }

    private onModified(resource: T) {
        const nodeId = this.identifier(resource)
        const visNode = this.visNetworkNodes.get(nodeId)
        const visEdge = this.visNetworkEdges.get(nodeId)
        this.OnChangeHook("MODIFIED", resource, visNode, visEdge)
        this.visNetwork.redraw()
    }

    private onDeleted(resource: T) {
        const nodeId = this.identifier(resource)
        this.visNetworkNodes.remove(nodeId)
        this.visNetworkEdges.remove(nodeId)
        this.OnChangeHook("DELETED", resource, null, null)
        this.visNetwork.redraw()
    }
}
export class PodWatcherView extends WatcherView<V1Pod> {
    private previouslySelectedNodeId: string = null
    private previouslySelectedChildrenNodeIds: string[] = null
    constructor(containingDiv: HTMLDivElement, centerNodeId: string, watcher: IWatcher<V1Pod>, filter: Filter<V1Pod>) {
        super(containingDiv, centerNodeId, watcher, filter, (pod: V1Pod) => pod.metadata!.name!, (event: WatchableEvents, pod: V1Pod, visNode: vis.Node, visEdge: vis.Edge) => {
            console.log(event)
            switch (event) {
                case "ADDED":
                case "MODIFIED":
                    switch (pod.status!.phase) {
                        case "Running" || "Succeeded":
                            visNode.color = "#008000"
                            break
                        case "Pending":
                            visNode.color = "#FFFF00"
                            break
                        default:
                            visNode.color = "#FF0000"
                    }
            }
        })
        const self = this as IWatcherView<V1Pod>
        self.on("selected", (pod: V1Pod) => {
            const podNodeId = pod.metadata.name
            if (this.previouslySelectedNodeId !== null) {
                this.previouslySelectedChildrenNodeIds.forEach((containerNodeId) => {
                    this.visNetworkEdges.remove(containerNodeId)
                    this.visNetworkNodes.remove(containerNodeId)
                    this.visNetwork.redraw()
                })
            }
            this.previouslySelectedNodeId = podNodeId
            this.previouslySelectedChildrenNodeIds = []
            pod.spec.containers.forEach((container: V1Container) => {
                const containerName = container.name
                const containerNodeId = pod.metadata.name + "_" + containerName
                this.visNetworkNodes.add({ id: containerNodeId , label: containerName, shape: "box" })
                this.visNetworkEdges.add({ id: containerNodeId, to: podNodeId, from: containerNodeId , length: 50 + Math.floor(100)})
                this.previouslySelectedChildrenNodeIds.push(containerNodeId)
                this.visNetwork.redraw()
            })

        })
    }
}