import { V1Node, V1Pod } from "@kubernetes/client-node"
import { IWatcher, Kubernetes, newKubeConfig, PodView, PodWatcherView, WatchableEvents, Watcher, WatcherView, ResourcePodHealthTracker } from "kruit"
import $ from "jquery"


// This launches the plugin
export = (): void => {
    $("head").append(`<link href="node_modules/vis/dist/vis-network.min.css" rel="stylesheet" type="text/css" />`)
    $("#container").append(`
        <div class="node_view_top"/>
        <div class="node_view_bottom tabs"/>
    `)
    const nodeViewer = new NodeViewer($("#container").get(0) as HTMLDivElement)
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
        $(this.topContainer).css("height", "50%")
        $(this.bottomContainer).css("height", "50%")

        const podWatcherView = new PodWatcherView(
            this.topContainer,
            this.clusterVisNodeId,
            this.podWatcher,
            (pod) => pod.spec!.nodeName === node.metadata!.name)

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
            }
            this.podView = new PodView(this.kubeConfig, pod, this.bottomContainer)
        })
    }

    private showNodeView() {
        $(this.topContainer).css("height", "100%")
        $(this.bottomContainer).css("height", "0%")

        const healthTracker = new ResourcePodHealthTracker(
            this.nodeWatcher, 
            this.podWatcher, 
            // ResourceIdentifier<V1Namespace>, this this provides the id to use for a namespace (the name)
            (namespace: Kubernetes.V1Node) => namespace.metadata!.name!,
            //  PodToResourceMapper this maps pods to namespaces via the id above (the namespace name)
            (pod: Kubernetes.V1Pod) => pod.spec!.nodeName!
        ) 
        const nodeWatcherView = new WatcherView<V1Node>(this.topContainer, this.clusterVisNodeId, 
            this.nodeWatcher, (node, health) => true, healthTracker)

        nodeWatcherView.on("selected", (namespace) => {
            this.nodeWatcher.removeAllWatchableEventListeners()
            healthTracker.destroy()
            nodeWatcherView.destroy()
            this.showPodWatcherView(namespace)
        })
    }
}
