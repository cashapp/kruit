import { V1Namespace } from "@kubernetes/client-node"
import { IWatcher, Kubernetes, newKubeConfig, PodView, PodWatcherView, WatchableEvents, Watcher, WatcherView } from "clustermuck"
import $ from "jquery"

// This launches the plugin
export = (context: any): void => {
    $("head").append(`<link href="node_modules/vis/dist/vis-network.min.css" rel="stylesheet" type="text/css" />`)
    $("#container").append(`
        <div class="node_view_top" style="height: 50%"/>
        <div class="node_view_bottom tabs" style="height: 50%"/>
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

    public showPodWatcherView(namespace: V1Namespace) {
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
        const namespaceWatcherView = new WatcherView<V1Namespace>(this.topContainer, this.clusterVisNodeId, this.namespaceWatcher,
            (namespace: V1Namespace) => true,
            (namespace: V1Namespace) => namespace.metadata!.name!,
            (event: WatchableEvents, node: V1Namespace, visNode: vis.Node, visEdge: vis.Edge) => {})

        namespaceWatcherView.on("selected", (namespace) => {
            this.namespaceWatcher.removeAllWatchableEventListeners()
            namespaceWatcherView.destroy()
            this.showPodWatcherView(namespace)
        })
    }
}
