import { KubeConfig, V1Container, V1Pod, dumpYaml } from "@kubernetes/client-node"
import { EventEmitter } from "events"
import * as vis from "vis"
import { PodWrapper } from "./kubernetes/pod_wrapper"
import { IWatchable, IWatcher, WatchableEvents } from "./kubernetes/watcher"
import { Tabs } from "./widgets"

export abstract class Komponent extends EventEmitter {}

export class PodView extends Komponent {

    private tabs = new Tabs(this.divContainer)

    constructor(private kubeConfig: KubeConfig, private pod: V1Pod, private divContainer: HTMLDivElement) {
        super()

        const wrappedProd = new PodWrapper(this.kubeConfig, pod!)
        const logTab = this.tabs.addTab(`yaml`)
        logTab.addText(dumpYaml(pod))

        for (const container of pod.spec.containers) {
            const logTab = this.tabs.addTab(`${container.name} logs`)
            wrappedProd.followLogs(container.name).then((stream) => {
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
    }

    public destroy() {
        this.tabs.destroy()
    }
}

export type Filter<T> = (resource: T, health: HealthStatus) => boolean
export type WatcherViewEvent = "selected" | "back"

type ResourceIdentifier<T> = (resource: T) => string
type PodToResourceMapper<T> = (pod: V1Pod) => string


export type HealthStatus = "HAPPY" | "PENDING" | "SAD" | "UNKOWN"

// IHealthTracker defines an interface for tracking/checking a resource's health.
export interface IHealthTracker<T> {
    checkHealth(resource: T): HealthStatus
    on(event: "refresh", listener: (resource: T) => void): void
}

// DefaultNodeFactory creates the default vis.Node instances when another INodeFactory hasn't been supplied.
class DefaultHealthTracker<T extends IWatchable> implements IHealthTracker<T> {
    public checkHealth(): HealthStatus { return "HAPPY" }

    public on(event: "refresh", listener: (resource: T) => void) {
        // NOOP only here to satisfy INodeFactory
        return
    }
}

export class ResourcePodHealthTracker<T extends IWatchable> extends EventEmitter implements IHealthTracker<T> {
    private podsByNameByResourceName: Map<string, Map<string, V1Pod>> = new Map()

    constructor(private resourceWatcher: IWatcher<T>, private podWatcher: IWatcher<V1Pod>,
                private resourceIdentifier: ResourceIdentifier<T>, private resourceMapper: PodToResourceMapper<T>) {
        super()

        //  initial map with all resources that are currently known, we might not know about the pods yet
        //  it's also possible the resources are "empty" in that no pods will map to them below
        for (const [resourceName] of this.resourceWatcher.getCached()) {
            this.podsByNameByResourceName.set(resourceName, new Map<string, V1Pod>())
        }

        //  fill in the pods
        for (const [podName, pod] of this.podWatcher.getCached()) {
            const resourceName = this.resourceMapper(pod)
            if (resourceName === undefined) {
                continue
            }

            if (!this.podsByNameByResourceName.has(resourceName)) {
                this.podsByNameByResourceName.set(resourceName, new Map<string, V1Pod>())
            }
            this.podsByNameByResourceName.get(resourceName)!.set(podName, pod)
        }

        this.addListeners()
    }

    public destroy() {
        this.removeListeners()
    }

    public checkHealth(resource: T): HealthStatus {
        const resourceName = this.resourceIdentifier(resource)
        if (!this.podsByNameByResourceName.has(resourceName)) {
            return "UNKOWN"
        }

        let happy = 0, pending = 0, sad = 0
        const podsByName = this.podsByNameByResourceName!.get(resourceName)!
        for (const [, pod] of podsByName) {
                switch (pod.status!.phase) {
                    case "Running" || "Succeeded":
                        happy++
                        break
                    case "Pending":
                        pending++
                        break
                    default:
                        sad++
                }
            }

        if (sad > 0) {
            return "SAD"
        }

        if (pending > 0) {
            return "PENDING"
        }

        return "HAPPY"
    }

    private emitRefresh(resourceName: string) {
        //  NB: It's possible that we get pod information before the resource watcher
        //  knows about the resource.
        const resource = this.resourceWatcher.getCached().get(resourceName)
        if (!resource) {
            return
        }
        this.emit("refresh", resource)
    }

    private addListeners() {
        this.resourceWatcher.on("ADDED", this.onResourceAdded)
        this.resourceWatcher.on("DELETED", this.onResourceDeleted)
        this.podWatcher.on("ADDED", this.onPodAdded)
        this.podWatcher.on("DELETED", this.onPodDeleted)
        this.podWatcher.on("MODIFIED", this.onPodModified)
    }

    private removeListeners() {
        this.resourceWatcher.removeListener("ADDED", this.onResourceAdded)
        this.resourceWatcher.removeListener("DELETED", this.onResourceDeleted)
        this.podWatcher.removeListener("ADDED", this.onPodAdded)
        this.podWatcher.removeListener("DELETED", this.onPodDeleted)
        this.podWatcher.removeListener("MODIFIED", this.onPodModified)
    }

    //  NB(gflarity) Force bind so that can be used/removed from event emitters
    //  tslint:disable-next-line: member-ordering
    private onResourceAdded = this._onResourceAdded.bind(this)
    private _onResourceAdded(resource: T) {
        const resourceName = this.resourceIdentifier(resource)
        if (this.podsByNameByResourceName.has(resourceName)) {
            return
        }
        this.podsByNameByResourceName.set(resourceName, new Map<string, V1Pod>())
        this.emit("refresh", resource)
    }


    //  NB(gflarity) Force bind so that can be used/removed from event emitters
    //  tslint:disable-next-line: member-ordering
    private onResourceDeleted = this._onResourceDeleted.bind(this)
    private _onResourceDeleted(resource: T) {
        const resourceName = this.resourceIdentifier(resource)
        if (!this.podsByNameByResourceName.has(resourceName)) {
            return
        }
        this.podsByNameByResourceName.delete(resourceName)
        this.emit("refresh", resource)
    }

    //  NB(gflarity) Force bind so that can be used/removed from event emitters
    //  tslint:disable-next-line: member-ordering
    private onPodAdded = this._onPodAdded.bind(this)
    private _onPodAdded(pod: V1Pod) {
        const resourceName = this.resourceMapper(pod)
        if (resourceName === undefined) {
            return
        }
        if (!this.podsByNameByResourceName.has(resourceName)) {
            this.podsByNameByResourceName.set(resourceName, new Map<string, V1Pod>())
        }
        const podName = pod.metadata.name
        this.podsByNameByResourceName.get(resourceName)!.set(podName, pod)
        this.emitRefresh(resourceName)
    }

    //  NB(gflarity) Force bind so that can be used/removed from event emitters
    //  tslint:disable-next-line: member-ordering
    private onPodDeleted = this._onPodDeleted.bind(this)
    private _onPodDeleted(pod: V1Pod) {
        const resourceName = this.resourceMapper(pod)
        if (resourceName === undefined) {
            return
        }
        if (!this.podsByNameByResourceName.has(resourceName)) {
            this.podsByNameByResourceName.set(resourceName, new Map<string, V1Pod>())
        }

        const podName = pod.metadata!.name!
        if (!this.podsByNameByResourceName.get(resourceName)!.has(podName)) {
            return
        }
        this.podsByNameByResourceName.get(resourceName)!.delete(podName!)
        this.emitRefresh(resourceName)
    }

    //  NB(gflarity) Force bind so that can be used/removed from event emitters
    //  tslint:disable-next-line: member-ordering
    private onPodModified = this._onPodModified.bind(this)
    private _onPodModified(pod: V1Pod) {
        const resourceName = this.resourceMapper(pod)
        if (resourceName === undefined) {
            return
        }
        if (!this.podsByNameByResourceName.has(resourceName)) {
            this.podsByNameByResourceName.set(resourceName, new Map<string, V1Pod>())
        }

        const podName = pod.metadata!.name
        this.podsByNameByResourceName.get(resourceName!)!.set(podName!, pod)
        this.emitRefresh(resourceName)
    }
}

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
        // The node sho
        if (this.visNetworkNodes.get(nodeID)) {
            console.log(`Warning, node alreaded added: ${nodeID}`)
        }

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
            console.log(`removing edge ${nodeId}`)
            this.visNetworkEdges.remove(nodeId)
            this.redraw = true
        }
        const visNode = this.visNetworkNodes.get(nodeId)
        if (visNode) {
            console.log(`removing node ${nodeId}`)
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


