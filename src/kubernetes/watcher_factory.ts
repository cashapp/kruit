import * as k8s from "@kubernetes/client-node"
import { EventEmitter } from 'events'
import { V1ObjectMeta } from '@kubernetes/client-node';
import { removeAllListeners } from "cluster";


// IWatchable describes the structure of kubernetes resource classes. Some of those resources can be watched.
export interface IWatchable {
    "aapiVersion" ?: string
    "kind"?: string
    "metadata"?: k8s.V1ObjectMeta
}

// IWatchableContructor defines the custructor of an IWatchable.
export type IWatchableContructor = new () => IWatchable

// WatchableEvents defines the names of the events you can expect to listen
// on with a Watcher<T>.
export type WatchableEvents = "ADDED" | "MODIFIED" | "DELETED" | "error"

// IWatcher defines the generic interface of something that "watches" kubernetes resources.
export interface IWatcher<T extends IWatchable> {
    on(event: WatchableEvents, listener: (v: T) => void): void
    emit(event: WatchableEvents, resource: T): void
    removeAllWatchableEventListeners(): void
    getCached() : Map<string, T>
    
}

// Watcher provides an EventEmitter which can be used to "watch" Kubernetes resouces easily.
export class Watcher<T extends IWatchable> extends EventEmitter implements IWatcher<T> {

    // cache holds the currently available resources observed by this watcher keyed by their name
    cache: Map<string, T> = new Map()

    // newIWatcher calls the protected constructore function and "casts" the result as an IWatcher<T> so that the
    // caller can take advantage of the typing provided by
    public static newIWatcher<T extends IWatchable>(kubeConfig: k8s.KubeConfig, watched: new () => T): IWatcher<T> {
        return new Watcher<T>(kubeConfig, (watched as unknown) as IWatchableContructor)
    }
    
    // Create a new Watcher<T>. You can "cast" the object to IWatcher<T> in order to get typing information
    // for "on" and "emit".
    private constructor(kubeConfig: k8s.KubeConfig, watched: IWatchableContructor) {
        // Initialize EventEmitter
        super()
        
        const self = this
       
        const watchPath = Watcher.pathFromConstructor(watched)

        // setup the watch to emit the appropriate events
        const watch = new k8s.Watch(kubeConfig)
        const res = watch.watch(watchPath, {},
            (eventType: WatchableEvents, obj: IWatchable) => {
                const name = (obj.metadata as V1ObjectMeta).name
                switch (eventType) {
                    case "ADDED" || "MODIFIED":
                        self.cache.set(name, obj as T)
                        break
                    case "DELETED":
                        if (self.cache.has(name)) {
                            self.cache.delete(name)
                        } else {
                            console.log(`unexpected resource: ${name}`)
                        }
                        break                      
                }
                this.emit(eventType, obj)
        },
        // done callback is called if the watch terminates normally
        (err) => {
            if (err) {
                this.emit("error", err)
            }
            this.emit("done")
        })

        // TODO error handling around the rest request failing
        console.log(res)
    }

    private static versionRegex = /(V\d+((Alpha|Beta)\d*)?)/

    public static pathFromConstructor(func: IWatchableContructor): string {
        if (!apiBaseLookup.has(func)) {
            throw new Error(`${func.name} is not watchable`)
        }

        const base = apiBaseLookup.get(func)        
        const name = func.name        
        const matches = name.match(this.versionRegex)
        if (matches.length === 0)  {
            throw new Error("could not match prefix of resource (V1 V2Beta1 etc)")
        }
         
        const prefix = matches[0].toLowerCase()
        let renaming = name.substr(prefix.length).toLowerCase()

        // if the last character isn't an 's', then we pluralize it
        if (renaming[renaming.length] !== "s") {
            renaming += "s"
        }
        return `/${base}/${prefix}/${renaming}`
    }

    public getCached(): Map<string, T> {
        return this.cache
    }

    public removeAllWatchableEventListeners() {
        this.removeAllListeners("ADDED")
        this.removeAllListeners("MODIFIED")
        this.removeAllListeners("DELETED")
        this.removeAllListeners("error")
    }
}

// watchUrlLookup is used to keep track of the urls used to watch particular kubernetes resources. There doesn't
// appear to be a way to get this programmatically from the kubernetes client at the time of writing.
const apiBaseLookup: Map<IWatchableContructor, string> = new Map()
apiBaseLookup.set(k8s.V1Node, "api")
apiBaseLookup.set(k8s.V1Namespace, "api")
apiBaseLookup.set(k8s.V1Pod, "api")
apiBaseLookup.set(k8s.V1Deployment, "apis/apps")

