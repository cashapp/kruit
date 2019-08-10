import { V1Node, V1Pod } from '@kubernetes/client-node';
import { IWatcher, Kubernetes, newKubeConfig, PodView, Watcher, WatcherView } from "clustermuck"
import $ from "jquery"


// This launches the plugin
export = (): void => {
    $("head").append(`<link href="node_modules/vis/dist/vis-network.min.css" rel="stylesheet" type="text/css" />`)
    $("#container").append(`
        <div class="node_view_top" style="height: 50%"/>
        <div class="node_view_bottom tabs" style="height: 50%"/>
    `)
}

class NodeViewer {
    private kubeConfig = newKubeConfig()
    private clusterVisNodeId = this.kubeConfig.currentContext
    private nodeWatcher: IWatcher<Kubernetes.V1Node>
    private podWatcher: IWatcher<Kubernetes.V1Pod>
    private topContainer: HTMLDivElement = $(this.container).find(".node_view_top").get(0)
    private bottomContainer: HTMLDivElement = $(this.container).find(".node_view_bottom").get(0)
    private podView: PodView | undefined

    constructor(private container: HTMLDivElement) {
        this.nodeWatcher = Watcher.newIWatcher(this.kubeConfig, Kubernetes.V1Node)
        this.nodeWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })

        // setup pod watcher
        this.podWatcher = Watcher.newIWatcher(this.kubeConfig, Kubernetes.V1Pod)
        this.podWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })

        this.showNodeView()
    }

    public showPodWatcherView(node: V1Node) {
        const podWatcherView = new WatcherView<V1Pod>(this.topContainer, this.clusterVisNodeId, this.podWatcher,
            (pod) => pod.spec!.nodeName === node.metadata!.name , (pod) => pod.metadata!.name!)

        podWatcherView.on("back", () => {
            if (this.podView) {
                this.podView.destroy()
                this.podView = undefined
            }
            this.podWatcher.removeAllWatchableEventListeners()
            podWatcherView.destroy()
            this.showNodeView()
        })

        podWatcherView.on("selected", (pod) => {
            if (this.podView) {
                this.podView.destroy()
                this.podView = undefined
            }
            this.podView = new PodView(this.kubeConfig, pod, this.bottomContainer)
        })
    }

    private showNodeView() {
        const nodeWatcherVIew = new WatcherView<V1Node>(this.topContainer, this.clusterVisNodeId, this.nodeWatcher,
            () => true, (namespace: V1Node) => namespace.metadata!.name!)

        nodeWatcherVIew.on("selected", (namespace) => {
            this.nodeWatcher.removeAllWatchableEventListeners()
            nodeWatcherVIew.destroy()
            this.showPodWatcherView(namespace)
        })
    }
}
