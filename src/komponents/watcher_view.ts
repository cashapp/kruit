import { IWatchable, IWatcher } from "../kubernetes/watcher"
import { DefaultHealthTracker, HealthStatus, IHealthTracker, ResourcePodHealthTracker } from "./health_trackers"
import { Komponent } from "./komponents"
export type Filter<T> = (resource: T, health: HealthStatus) => boolean
export type WatcherViewEvent = "selected" | "back"
import {  V1Container, V1Pod } from "@kubernetes/client-node"
import * as vis from "vis"


export interface IWatcherView<T> {
    on(event: "selected", listener: (resource: T) => void): void
    on(event: "back", listener: () => void): void
}

export class WatcherView<T extends IWatchable> extends Komponent {
    protected rootColour = "#f7da00"
    protected visNetworkNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    protected visNetworkEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])
    protected visNetwork: vis.Network
    // track the redraw interval for disabling it during destroy
    private redrawIntervalId: NodeJS.Timeout
    // track if a disable timeout has been set, we'll be releasing if a redraw occurs before it's been processed
    private disableTimeout: NodeJS.Timeout
    private redraw = false
    private physicsConfig = {
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

    // adding nodes in batches improves visjs drawing performance
    private nodeUpdateQueue = new Array<vis.Node>()
    private edgeUpsertQueue = new Array<vis.Edge>()

    constructor(private container: HTMLDivElement, private centerNodeId: string,
                private watcher: IWatcher<T>,
                private filter: Filter<T>,
                private healthTracker: IHealthTracker<T> = new DefaultHealthTracker<T>(),
                private includeEdges = false,
                ) {
            super()

            // attempt to fit for the first 2 seconds
            let count = 0
            const intervalID = setInterval(() => {
                if (count++ < 10) {
                    this.visNetwork.fit()
                } else {
                    clearInterval(intervalID)
                }
            }, 200)

            // create an interval to check if we should redraw or not
            this.redrawIntervalId = setInterval(this.doRedraw.bind(this), 200)

            this.visNetwork = new vis.Network(this.container, { nodes: this.visNetworkNodes, edges: this.visNetworkEdges}, this.physicsConfig)

            this.visNetworkNodes.add({id: centerNodeId, label: centerNodeId, color: this.rootColour })

            const resources = Array.from(this.watcher.getCached().values())
            const nodes = new Array<vis.Node>()
            const edges = new Array<vis.Edge>()
            resources.forEach((resource) => {
                const health = this.healthTracker.checkHealth(resource)
                // filter this resource?
                if (!this.filter(resource, health)) {
                    return
                }
                const nodeID = resource.metadata!.name
                const visNode: vis.Node = this.createNode(resource, health)
                this.nodeUpdateQueue.push(visNode)
                if (this.includeEdges) {
                    const visEdge: vis.Edge = { to: centerNodeId, from: nodeID, id: nodeID }
                    this.edgeUpsertQueue.push(visEdge)
                }
            })
            this.redraw = true

            this.visNetwork.on("selectNode", (params) => {
                const selectedNetworkNodeId = this.visNetwork.getNodeAt(params.pointer.DOM) as string
                if (selectedNetworkNodeId === this.centerNodeId) {
                    this.emit("back")
                } else {
                    console.log(`selected: ${selectedNetworkNodeId}`)
                    this.emit("selected", this.watcher.getCached().get(selectedNetworkNodeId))
                }
            })

            this.registerListeners()

            this.healthTracker.on("refresh", (resource) => {
                const health = this.healthTracker.checkHealth(resource)
                if (!this.filter(resource, health)) {
                    this.removeFromGraphIfExists(resource)
                    return
                }
                const visNode: vis.Node = this.createNode(resource, health)
                this.nodeUpdateQueue.push(visNode)
                if (this.includeEdges) {
                    const visEdge: vis.Edge = { to: centerNodeId, from: resource.metadata!.name, id: resource.metadata!.name }
                    this.edgeUpsertQueue.push(visEdge)
                }
                this.redraw = true
            })
    }

    public destroy() {
        this.unregisterListeners()
        this.removeAllListeners()
        clearInterval(this.redrawIntervalId)
    }

    public createNode(resource: T, health: HealthStatus): vis.Node {
        let colour = ""
        if (health === "UNKOWN") {
            //  TODO fix unknown colour
            colour = "#111111"
        } else if (health === "SAD") {
            colour = "#FF0000"
        } else if (health === "PENDING") {
            colour = "#FFFF00"
        } else {
            // happy!
            colour = "#008000"
        }
        return { id: resource.metadata!.name, label: resource.metadata!.name, shape: "box", color: colour }
    }

    private doRedraw() {
        // if redraw hasn' been request, shortcircuit
        if (!this.redraw) {
            return
        }

        // clear redraw flag
        this.redraw = false

        // if there's a pending disable then clear it, we're going to set a new one
        if (this.disableTimeout) {
            clearTimeout(this.disableTimeout)
        }

        this.visNetworkNodes.update(this.nodeUpdateQueue)
        this.nodeUpdateQueue = new Array<vis.Node>()
        this.visNetworkEdges.update(this.edgeUpsertQueue)
        this.edgeUpsertQueue = new Array<vis.Edge>()
        this.visNetwork.setOptions(this.physicsConfig)
        this.visNetwork.redraw()

        // we don't want it to move stuff around forever, stop after 2 seconds
        return setTimeout(() => {
            this.visNetwork.setOptions({physics: false})
        }, 2000)
    }

    private registerListeners() {
        this.watcher.on("ADDED", this.onAdded.bind(this))
        this.watcher.on("DELETED", this.onDeleted.bind(this))
    }

    private unregisterListeners() {
        this.watcher.removeListener("ADDED", this.onAdded)
        this.watcher.removeListener("DELETED", this.onDeleted)
    }

    private onAdded(resource: T) {
        const health = this.healthTracker.checkHealth(resource)
        // is this a pod we're interested in?
        if (!this.filter(resource, health)) {
            this.removeFromGraphIfExists(resource)
            return
        }

        const nodeID = resource.metadata!.name!

        const visNode: vis.Node = this.createNode(resource, health)
        this.nodeUpdateQueue.push(visNode)

        if (this.includeEdges) {
            const visEdge: vis.Edge = { to: this.centerNodeId, from: nodeID, length: this.calculateEdgeLength(), id: nodeID }
            this.edgeUpsertQueue.push(visEdge)
        }
        this.redraw = true
    }

    private removeFromGraphIfExists(resource: T) {
        // first we trigger a redraw so that the graph incoporates any pending updates
        this.redraw = true
        this.doRedraw()

        // now moreve nodes 
        const nodeId = resource.metadata!.name!
        const visEdge = this.visNetworkEdges.get(nodeId)
        if (visEdge) {
            this.visNetworkEdges.remove(nodeId)
            this.redraw = true
        }
        const visNode = this.visNetworkNodes.get(nodeId)
        if (visNode) {
            this.visNetworkNodes.remove(nodeId)
            this.redraw = true
        }
        return
    }

     private onDeleted(resource: T) {
        this.removeFromGraphIfExists(resource)
    }

    private calculateEdgeLength(): number | undefined {
        return undefined
    }
}


export class PodWatcherView extends WatcherView<V1Pod> {
    private previouslySelectedNodeId: string | null = null
    private previouslySelectedChildrenNodeIds: string[] | null = null
    constructor(containingDiv: HTMLDivElement, centerNodeId: string, watcher: IWatcher<V1Pod>, filter: Filter<V1Pod>) {
        super(containingDiv, centerNodeId, watcher, filter, new ResourcePodHealthTracker(
            watcher, watcher, (namespace: V1Pod) => namespace.metadata!.name!, (pod: V1Pod) => pod.metadata!.name!))
        const self = this as IWatcherView<V1Pod>
        self.on("selected", (pod: V1Pod) => {
            // sometimes if you drag the graph instead of clicking it gives a selected
            if (pod === undefined) {
                return
            }

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
                let colour = ""

                if (!pod.status.containerStatuses) {
                    colour = "#FF0000"
                    return
                }

                for (const status of pod.status.containerStatuses) {
                    if (status.name !== containerName) {
                        continue
                    }
                    if (status.state.running){
                        colour = "#008000"
                    } else {
                        colour = "#FF0000"
                    }
                    break
                }
                const containerNodeId = pod.metadata!.name! + "_" + containerName
                this.visNetworkNodes.add({ id: containerNodeId , label: containerName, shape: "box", color: colour })
                this.visNetworkEdges.add({ id: containerNodeId, to: podNodeId, from: containerNodeId , length: 50 + Math.floor(100)})
                this.previouslySelectedChildrenNodeIds!.push(containerNodeId)
                this.visNetwork.redraw()
            })

        })
    }
}