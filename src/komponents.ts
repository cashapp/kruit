import { KubeConfig, V1Container, V1Namespace, V1Node, V1Pod } from "@kubernetes/client-node"
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
export type OnChange<T> = (event: WatchableEvents, resource: T, visNode: vis.Node | null, visEdge: vis.Edge | null) => void
export type WatcherViewEvent = "selected" | "back"

export interface IWatcherView<T> {
    on(event: "selected", listener: (resource: T) => void): void
    on(event: "back", listener: () => void): void
}

// INodeFactory defines an interface of node factories which create vis.Nodes. They provide WatcherView with a
// mechanism for having customer node shapes/colours/sizes.
// custom nodes (colouring/shapes/size etc).
export interface INodeFactory<T extends IWatchable> {
    createNode(resource: T): vis.Node
    on(event: "refresh", listener: (resource: T) => void): void
}


// DefaultNodeFactory creates the default vis.Node instances when another INodeFactory hasn't been supplied.
class DefaultNodeFactory<T extends IWatchable> implements INodeFactory<T> {
    public createNode(resource: T): vis.Node {
        return { id: resource.metadata!.name, label: resource.metadata!.name, shape: "box" }
    }

    public on(event: "refresh", listener: (resource: T) => void) {
        // NOOP only here to satisfy INodeFactory
        return
    }
}

export class WatcherView<T extends IWatchable> extends Komponent {
    protected rootColour = "#f7da00"
    protected visNetworkNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    protected visNetworkEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])
    protected visNetwork: vis.Network
    private redrawIntervalId: NodeJS.Timeout
    private redraw = false

    // adding nodes in batches improves visjs drawing performance
    private nodeUpdateQueue = new Array<vis.Node>()
    private edgeUpsertQueue = new Array<vis.Edge>()

    constructor(private container: HTMLDivElement, private centerNodeId: string,
                private watcher: IWatcher<T>,
                private filter: Filter<T>,
                private OnChangeHook: OnChange<T>,
                private nodeFactory: INodeFactory<T> = new DefaultNodeFactory<T>()) {
            super()

            const physics = {
                physics: {
                    forceAtlas2Based: {
                      gravitationalConstant: -500,
                      centralGravity: 0.1,
                      springLength: 100,
                      damping: 1,
                    },
                    maxVelocity: 1000,
                    minVelocity: 1,
                    solver: "forceAtlas2Based",
                    timestep: 0.33,
                },
            }

            // attempt to fit for the first 2 seconds
            let count = 0
            const intervalID = setInterval(() => {
                if (count++ < 10) {
                    this.visNetwork.fit()
                } else {
                    clearInterval(intervalID)
                }
            }, 200)

            // track if a disable timeout has been set, we'll be releasing it if so
            let disableTimeout: NodeJS.Timeout

            // create an interval to check if we should redraw or not
            this.redrawIntervalId = setInterval(() => {
                // if redraw hasn' been request, bail
                if (!this.redraw) {
                    return
                }

                // clear redraw flag
                this.redraw = false

                // if there's a pending disable then clear it, we're going to set a new one
                if (disableTimeout) {
                    clearTimeout(disableTimeout)
                }

                this.visNetworkNodes.update(this.nodeUpdateQueue)
                this.nodeUpdateQueue = new Array<vis.Node>()
                this.visNetworkEdges.update(this.edgeUpsertQueue)
                this.edgeUpsertQueue = new Array<vis.Edge>()
                this.visNetwork.setOptions(physics)
                this.visNetwork.redraw()

                // we don't want it to move stuff around forever, stop after 2 seconds
                disableTimeout = setTimeout(() => {
                    this.visNetwork.setOptions({physics: false})

                }, 2000)
            }, 200)

            this.visNetwork = new vis.Network(this.container, { nodes: this.visNetworkNodes, edges: this.visNetworkEdges}, physics)

            this.visNetworkNodes.add({id: centerNodeId, label: centerNodeId, color: this.rootColour })

            const resources = Array.from(this.watcher.getCached().values()).filter(filter)
            const nodes = new Array<vis.Node>()
            const edges = new Array<vis.Edge>()
            resources.forEach((resource) => {
                const nodeID = resource.metadata!.name
                const visNode: vis.Node = this.nodeFactory.createNode(resource)
                const visEdge: vis.Edge = { to: centerNodeId, from: nodeID }
                this.OnChangeHook("ADDED", resource, visNode, visEdge)
                this.nodeUpdateQueue.push(visNode)
                this.edgeUpsertQueue.push(visEdge)
            })
            this.redraw = true

            this.visNetwork.on("selectNode", (params) => {
                const selectedNetworkNodeId = this.visNetwork.getNodeAt(params.pointer.DOM) as string
                if (selectedNetworkNodeId === this.centerNodeId) {
                    this.emit("back")
                } else {
                    this.emit("selected", this.watcher.getCached().get(selectedNetworkNodeId))
                }
            })

            this.registerListeners()

            nodeFactory.on("refresh", (namespace) => {
                const visNode: vis.Node = this.nodeFactory.createNode(namespace)
                this.nodeUpdateQueue.push(visNode)
                this.redraw = true
            })
    }

    public destroy() {
        this.unregisterListeners()
        this.removeAllListeners()
        clearInterval(this.redrawIntervalId)
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
        // is this a pod we're interested in?
        if (!this.filter(resource)) {
            return
        }
        const nodeID = resource.metadata!.name!
        // The node sho
        if (this.visNetworkNodes.get(nodeID)) {
            console.log(`Warning, node alreaded added: ${nodeID}`)
        }
        const visNode: vis.Node = this.nodeFactory.createNode(resource)
        const visEdge: vis.Edge = { to: this.centerNodeId, from: nodeID, length: this.calculateEdgeLength() }
        this.OnChangeHook("ADDED", resource, visNode, visEdge)
        this.nodeUpdateQueue.push(visNode)
        this.edgeUpsertQueue.push(visEdge)
        this.redraw = true
    }

    private onModified(resource: T) {
        // is this a pod we're interested in?
        if (!this.filter(resource)) {
            return
        }
        const nodeId = resource.metadata!.name!
        const visNode = this.visNetworkNodes.get(nodeId)
        const visEdge = this.visNetworkEdges.get(nodeId)
        this.OnChangeHook("MODIFIED", resource, visNode!, visEdge!)
        this.redraw = true
    }

    private onDeleted(resource: T) {
        // is this a pod we're interested in?
        if (!this.filter(resource)) {
            return
        }
        const nodeId = resource.metadata!.name!
        this.visNetworkNodes.remove(nodeId)
        this.visNetworkEdges.remove(nodeId)
        this.OnChangeHook("DELETED", resource, null, null)
        this.redraw = true
    }

    private calculateEdgeLength(): number | undefined {
        return undefined
    }
}

export class PodWatcherView extends WatcherView<V1Pod> {
    private previouslySelectedNodeId: string | null = null
    private previouslySelectedChildrenNodeIds: string[] | null = null
    constructor(containingDiv: HTMLDivElement, centerNodeId: string, watcher: IWatcher<V1Pod>, filter: Filter<V1Pod>) {
        super(containingDiv, centerNodeId, watcher, filter, (event: WatchableEvents, pod: V1Pod, visNode: vis.Node | null, visEdge: vis.Edge | null) => {
            switch (event) {
                case "ADDED":
                case "MODIFIED":
                    switch (pod.status!.phase) {
                        case "Running" || "Succeeded":
                            visNode!.color = "#008000"
                            break
                        case "Pending":
                            visNode!.color = "#FFFF00"
                            break
                        default:
                            visNode!.color = "#FF0000"
                    }
            }
        })
        const self = this as IWatcherView<V1Pod>
        self.on("selected", (pod: V1Pod) => {
            const podNodeId = pod.metadata!.name!
            if (this.previouslySelectedNodeId !== null) {
                this.previouslySelectedChildrenNodeIds!.forEach((containerNodeId) => {
                    this.visNetworkEdges.remove(containerNodeId)
                    this.visNetworkNodes.remove(containerNodeId)
                    this.visNetwork.redraw()
                })
            }
            this.previouslySelectedNodeId = podNodeId
            this.previouslySelectedChildrenNodeIds = []
            pod.spec!.containers.forEach((container: V1Container) => {
                const containerName = container.name
                const containerNodeId = pod.metadata!.name! + "_" + containerName
                this.visNetworkNodes.add({ id: containerNodeId , label: containerName, shape: "box" })
                this.visNetworkEdges.add({ id: containerNodeId, to: podNodeId, from: containerNodeId , length: 50 + Math.floor(100)})
                this.previouslySelectedChildrenNodeIds!.push(containerNodeId)
                this.visNetwork.redraw()
            })

        })
    }
}