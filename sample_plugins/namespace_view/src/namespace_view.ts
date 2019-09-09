import { IWatcher, Kubernetes, newKubeConfig, PodView, PodWatcherView, WatchableEvents, Watcher, WatcherView, PodHealthColouredNodeFactory } from "kuitk"
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

        const namespaceColourer = new PodHealthColouredNodeFactory(
            this.namespaceWatcher, 
            this.podWatcher, 
            // ResourceIdentifier<V1Namespace>, this this provides the id to use for a namespace (the name)
            (namespace: Kubernetes.V1Namespace) => namespace.metadata!.name!,
            //  PodToResourceMapper this maps pods to namespaces via the id above (the namespace name)
            (pod: Kubernetes.V1Pod) => pod.metadata!.namespace!
        ) 
        const namespaceWatcherView = new WatcherView<Kubernetes.V1Namespace>(this.topContainer, this.clusterVisNodeId, this.namespaceWatcher,
            (namespace: Kubernetes.V1Namespace) => true,
            (event: WatchableEvents, node: Kubernetes.V1Namespace, visNode: vis.Node | null, visEdge: vis.Edge | null) => {},
            namespaceColourer)

        namespaceWatcherView.on("selected", (namespace) => {
            this.namespaceWatcher.removeAllWatchableEventListeners()
            namespaceWatcherView.destroy()
            namespaceColourer.destroy()
            this.showPodWatcherView(namespace)
        })
    }
}
