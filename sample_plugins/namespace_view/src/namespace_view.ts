import { IWatcher, Kubernetes, newKubeConfig, PodView, PodWatcherView, WatchableEvents, Watcher, WatcherView, INodeFactory, PodHealthAggregator } from "kuitk"
import $ from "jquery"
import { stringLiteral } from "@babel/types";
import { V1Namespace } from '@kubernetes/client-node';
import { Stream } from 'stream';
import { EventEmitter } from "events";

// This launches the plugin
export = (context: any): void => {
    $("head").append(`<link href="node_modules/vis/dist/vis-network.min.css" rel="stylesheet" type="text/css" />`)
    $("#container").append(`
        <div class="node_view_top"/>
        <div class="node_view_bottom tabs"/>
    `)
    const namespaceViewer = new NamespaceViewer($("#container").get(0) as HTMLDivElement)
}

class NamespaceNodeFactory extends EventEmitter implements INodeFactory<Kubernetes.V1Namespace> {
    private podsByNameByNamespaceName: Map<string, Map<string, Kubernetes.V1Pod>> = new Map()
    constructor(private namespaceWatcher: IWatcher<Kubernetes.V1Namespace>, private podWatcher: IWatcher<Kubernetes.V1Pod>) {
        super()
        // initial map with all namespaces that currently known
        for (let [namespaceName] of this.namespaceWatcher.getCached()) {
            this.podsByNameByNamespaceName.set(namespaceName, new Map<string, Kubernetes.V1Pod>())           
        }

        // fill in the pods
        for (let [podName, pod] of this.podWatcher.getCached()) {
            const namespace = pod.metadata!.namespace!
            this.podsByNameByNamespaceName.get(namespace)!.set(podName,pod)
        }
        
        this.addListeners()
    }

    public createNode(namespace: Kubernetes.V1Namespace): vis.Node {
        const namespaceName = namespace.metadata!.name! 
        const {pending, sad, unknown} = this.healthCheck(namespaceName)
        let colour = "#008000"
        if (unknown === true) {
            // TODO fix unknown colour
            colour = "#111111"
        } else if (sad > 0) {
            colour = "#FF0000"
        } else if (pending > 0) {
            colour = "#FFFF00"
        }
        return { id: namespace.metadata!.name, label: namespace.metadata!.name, shape: "box", color: colour }
    }

    public destroy() {
        this.removeListeners()
    }

    private healthCheck(namespaceName: string): {happy: number, pending: number, sad: number, unknown: boolean} {
        if (!this.podsByNameByNamespaceName.has(namespaceName)) {           
            return { happy: 0, pending: 0, sad: 0, unknown: true} 
        }

        let happy = 0, pending = 0, sad = 0
        const podsByName = this.podsByNameByNamespaceName!.get(namespaceName)!
        for (let [, pod] of podsByName) {
            switch (pod.status!.phase) {
                case "Running" || "Succeeded":
                    happy++
                    break
                case "Pending":
                    pending++
                    break
                default:
                    sad++
            }
        }
        return { happy: happy, pending: pending, sad: sad, unknown: false }
    }

    private emitRefresh(namespaceName: string) {
        // NB: It's possible that we get pod information before the namespace watcher
        // knows about it. Eventually we should get namespace information which will 
        // call a refresh as well, so we ignore this.
        const namespace = this.namespaceWatcher.getCached().get(namespaceName)
        if (!namespace) {
            return
        }
        this.emit("refresh", namespace)
    }

    private addListeners() {
        this.namespaceWatcher.on("ADDED", this.onNamespaceAdded)
        this.namespaceWatcher.on("DELETED", this.onNamespaceDeleted)
        this.podWatcher.on("ADDED", this.onPodAdded)
        this.podWatcher.on("DELETED", this.onPodDeleted)
        this.podWatcher.on("MODIFIED", this.onPodModified)
    }

    private removeListeners() {
        this.namespaceWatcher.removeListener("ADDED", this.onNamespaceAdded)
        this.namespaceWatcher.removeListener("DELETED", this.onNamespaceDeleted)
        this.podWatcher.removeListener("ADDED", this.onPodAdded)
        this.podWatcher.removeListener("DELETED", this.onPodDeleted)
        this.podWatcher.removeListener("MODIFIED", this.onPodModified)
    }

    // NB(gflarity) Force bind so that can be used/removed from event emitters
    private onNamespaceAdded = this._onNamespaceAdded.bind(this)
    private _onNamespaceAdded(namespace: Kubernetes.V1Namespace) {
        const namespaceName = namespace.metadata!.name!
        if (this.podsByNameByNamespaceName.has(namespaceName)) {
            console.log("namespace already exists in podsByNameByNamespaceName, this is unexpected")
            return
        }
        this.podsByNameByNamespaceName.set(namespace.metadata!.name!, new Map<string, Kubernetes.V1Pod>())
        this.emit("refresh", namespace)
    }

    // NB(gflarity) Force bind so that can be used/removed from event emitters
    private onNamespaceDeleted = this._onNamespaceDeleted.bind(this)
    private _onNamespaceDeleted(namespace: Kubernetes.V1Namespace) {
        const namespaceName = namespace.metadata!.name!
        if (!this.podsByNameByNamespaceName.has(namespaceName)) {
            console.log(`namespace ${namespaceName} does not exist in podsByNameByNamespaceName, this is unexpected`)
            return
        }
        this.podsByNameByNamespaceName.delete(namespace.metadata!.name!)
        this.emit("refresh", namespace)
    }

    // NB(gflarity) Force bind so that can be used/removed from event emitters
    private onPodAdded = this._onPodAdded.bind(this)
    private _onPodAdded(pod: Kubernetes.V1Pod) {
        const namespaceName = pod.metadata!.namespace!
        if (!this.podsByNameByNamespaceName.has(namespaceName)) {
            console.log(`namespace ${namespaceName} does not exist in podsByNameByNamespaceName, this is unexpected`)
            this.podsByNameByNamespaceName.set(namespaceName, new Map<string, Kubernetes.V1Pod>())
        }
        this.podsByNameByNamespaceName.get(namespaceName)!.set(pod.metadata!.name!, pod)
        this.emitRefresh(namespaceName)
    }
    private onPodDeleted = this._onPodDeleted.bind(this)
    private _onPodDeleted(pod: Kubernetes.V1Pod) {
        const namespaceName = pod.metadata!.namespace!
        if (!this.podsByNameByNamespaceName.has(namespaceName)) {
            console.log(`namespace ${namespaceName} does not exist in podsByNameByNamespaceName, this is unexpected`)
            this.podsByNameByNamespaceName.set(namespaceName, new Map<string, Kubernetes.V1Pod>())
        }
        
        const podName = pod.metadata!.name!
        if (!this.podsByNameByNamespaceName.get(namespaceName)!.has(podName)) {
            console.log(`pod ${podName} does not exist in podsByNameByNamespaceName, this is unexpected`)             
            return
        }
        this.podsByNameByNamespaceName.get(namespaceName)!.delete(podName!)
        this.emitRefresh(namespaceName)
    }

    private onPodModified = this._onPodModified.bind(this)
    private _onPodModified(pod: Kubernetes.V1Pod) {
        const namespaceName = pod.metadata!.namespace!
        if (!this.podsByNameByNamespaceName.has(namespaceName)) {
            console.log(`namespace ${namespaceName} does not exist in podsByNameByNamespaceName, this is unexpected`)
            this.podsByNameByNamespaceName.set(namespaceName, new Map<string, Kubernetes.V1Pod>())
        }
        
        const podName = pod.metadata!.name
        if (!this.podsByNameByNamespaceName.get(namespaceName!)!.has(podName!)) {
            console.log(`pod ${podName} does not exist in podsByNameByNamespaceName, this is unexpected`)             
        }
        this.podsByNameByNamespaceName.get(namespaceName!)!.set(podName!, pod)
        this.emitRefresh(namespaceName)
    }
}

class NamespaceViewer {
    private kubeConfig = newKubeConfig()
    private clusterVisNodeId = this.kubeConfig.currentContext
    private namespaceWatcher: IWatcher<Kubernetes.V1Namespace>
    private podWatcher: IWatcher<Kubernetes.V1Pod>
    private topContainer: HTMLDivElement = $(this.container).find(".node_view_top").get(0)
    private bottomContainer: HTMLDivElement = $(this.container).find(".node_view_bottom").get(0)
    private podView: PodView | undefined

    constructor(private container: HTMLDivElement) {
        this.namespaceWatcher = Watcher.newIWatcher(this.kubeConfig, Kubernetes.V1Namespace)
        this.namespaceWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })

        // setup pod watcher
        this.podWatcher = Watcher.newIWatcher(this.kubeConfig, Kubernetes.V1Pod)
        this.podWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })

        this.showNamespaceView()
    }

    public showPodWatcherView(namespace: Kubernetes.V1Namespace) {
        $(this.topContainer).css("height", "50%")
        $(this.bottomContainer).css("height", "50%")
        const podWatcherView = new PodWatcherView(
            this.topContainer,
            this.clusterVisNodeId,
            this.podWatcher,
            (pod) => pod.metadata!.namespace === namespace.metadata!.name)

        podWatcherView.on("back", () => {
            if (this.podView) {
                this.podView.destroy()
                this.podView = undefined
            }
            this.podWatcher.removeAllWatchableEventListeners()
            podWatcherView.destroy()
            this.showNamespaceView()
        })

        podWatcherView.on("selected", (pod) => {
            if (this.podView) {
                this.podView.destroy()
                this.podView = undefined
            }
            this.podView = new PodView(this.kubeConfig, pod, this.bottomContainer)
        })
    }

    private showNamespaceView() {
        $(this.topContainer).css("height", "100%")
        $(this.bottomContainer).css("height", "0%")

        const namespaceColourer = new NamespaceNodeFactory(this.namespaceWatcher, this.podWatcher)
        const namespaceWatcherView = new WatcherView<Kubernetes.V1Namespace>(this.topContainer, this.clusterVisNodeId, this.namespaceWatcher,
            (namespace: Kubernetes.V1Namespace) => true,
            (event: WatchableEvents, node: Kubernetes.V1Namespace, visNode: vis.Node, visEdge: vis.Edge) => {},
            namespaceColourer)

        namespaceWatcherView.on("selected", (namespace) => {
            this.namespaceWatcher.removeAllWatchableEventListeners()
            namespaceWatcherView.destroy()
            namespaceColourer.destroy()
            this.showPodWatcherView(namespace)
        })
    }
}
