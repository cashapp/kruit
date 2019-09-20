import { V1Pod } from "@kubernetes/client-node"
import { EventEmitter } from "events"
import { IWatchable, IWatcher } from "../kubernetes/watcher"

type ResourceIdentifier<T> = (resource: T) => string
type PodToResourceMapper<T> = (pod: V1Pod) => string

export type HealthStatus = "HAPPY" | "PENDING" | "SAD" | "UNKOWN"

// IHealthTracker defines an interface for tracking/checking a resource's health.
export interface IHealthTracker<T> {
    checkHealth(resource: T): HealthStatus
    on(event: "refresh", listener: (resource: T) => void): void
}

// DefaultNodeFactory creates the default vis.Node instances when another INodeFactory hasn't been supplied.
export class DefaultHealthTracker<T extends IWatchable> implements IHealthTracker<T> {
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
                    case "Running":
                        for (const conditions of pod.status.conditions) {
                            if (conditions.type === "Ready") {
                                if (conditions.status === "True") {
                                    happy++
                                } else {
                                    sad++
                                }
                                break
                            }
                        }
                        break
                    case "Succeeded":
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