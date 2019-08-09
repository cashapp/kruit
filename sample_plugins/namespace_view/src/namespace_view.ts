import { KubeConfig, V1Namespace, V1ObjectMeta, V1Pod, V1PodSpec } from "@kubernetes/client-node"
import { IWatcher, Kubernetes, newKubeConfig, PodWrapper, Tabs, Watcher } from "clustermuck"
import * as http from "http"
import $ from "jquery"

// TODO there should be type definitions in the near future, add them once they're available
import { statement } from "@babel/template";
import { removeAllListeners } from "cluster"
import * as vis from "vis"

// This launches the plugin
export = (context: any): void => {
    $("head").append(`<link href="node_modules/vis/dist/vis-network.min.css" rel="stylesheet" type="text/css" />`)
    $("#container").append(`
        <div class="node_view_top" style="height: 50%"/>
        <div class="node_view_bottom tabs" style="height: 50%"/>
    `)
    const nodeViewer = new NamespaceViewer($("#container").get(0) as HTMLDivElement)
}

// NodeViewerStateType defines the states that the node viewer can be in
type NodeViewerStateType = "pods" | "nodes"

enum NamespaceViewerStates {
    pods = "pods",
    namespaces = "namespaces",
}

class NamespaceViewer {
    public kubeConfig = newKubeConfig()
    public clusterVisNodeId = this.kubeConfig.currentContext
    public state: "pods" | "namespaces" = NamespaceViewerStates.namespaces
    public visNetworkNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    public visNetworkEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])
    public namespaceWatcher: IWatcher<Kubernetes.V1Namespace>
    public podWatcher: IWatcher<Kubernetes.V1Pod>
    public container: HTMLElement
    public visNetwork: vis.Network
    public selectedNetworkNodeId: string = this.clusterVisNodeId
    public rootColour = "#f7da00"
    public tabs: Tabs

    constructor(container: HTMLDivElement) {
        if (!container) {
            throw new Error("container must be defined and not null")
        }

        this.container = container
        const visContainer = $(container).find(".node_view_top").get(0) as HTMLDivElement

        this.visNetwork = new vis.Network(visContainer, { nodes: this.visNetworkNodes, edges: this.visNetworkEdges}, {
            layout: {
                improvedLayout: true,
            },
        })

        this.tabs = new Tabs($(container).find(".node_view_bottom").get(0) as HTMLDivElement)

        // setup node watcher
        const self = this
        this.namespaceWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Namespace)
        self.namespaceWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })

        // setup pod watcher
        this.podWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Pod)
        self.podWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })

        this.visNetwork.on("selectNode", (params) => {
            self.selectedNetworkNodeId = self.visNetwork.getNodeAt(params.pointer.DOM) as string
            switch (self.state) {
                case NamespaceViewerStates.namespaces:
                    // switch to pod view if we've selected a node
                    if (self.selectedNetworkNodeId !== self.clusterVisNodeId) {
                        self.stopNamespaceView()
                        self.showPodView()
                    }
                    break
                case NamespaceViewerStates.pods:
                    // is this a pod? then get the logs and print to a tab
                    if (self.podWatcher.getCached().has(self.selectedNetworkNodeId)) {
                        const pod = this.podWatcher.getCached().get(self.selectedNetworkNodeId)
                        self.tabs.clear()
                        const logTab = self.tabs.addTab(`${pod!.metadata!.name} logs`)
                        const wrappedProd = new PodWrapper(self.kubeConfig, pod!)    
                        wrappedProd.followLogs().then((stream) => {
                            stream.on("data", (line) => {
                                logTab.addText(line + "\n")                                
                                // TODO automatically scrolling to the bottom here seems
                                // to cause the ui to freeze momentarially. The textarea should take care of
                                // its own autoscrolling
                            })

                            // when the tab goes away the stream should stop writing to it
                            logTab.on("destroy", () => {
                                stream.destroy()
                            })
                        }).catch((err) => {
                            console.log(err)
                        })
                    } else {
                        // switch to node view if we've selected centre node
                        self.stopPodView()
                        self.showNamespaceView()
                    }
                    break
            }
        })

        this.showNamespaceView()
    }


    public stopPodView() {
        this.podWatcher.removeAllWatchableEventListeners()
        this.visNetworkEdges.clear()
        this.visNetworkNodes.clear()
        this.tabs.clear()
    }

    public showPodView() {
        const self = this
        self.state = NamespaceViewerStates.pods

        const helloTab = this.tabs.addTab("log")
        helloTab.addText("pods 1 2 3")

        self.visNetworkNodes.add({id: self.selectedNetworkNodeId, label: self.selectedNetworkNodeId, color: "#f7da00" })
        self.visNetwork.redraw()

        // selectedNetworkNodeId is holding the namespace name, so we want all pods on that node
        const pods = Array.from(self.podWatcher.getCached().values()).filter((pod) => (pod.metadata!.namespace === self.selectedNetworkNodeId))
        let count = 100
        pods.forEach((pod) => {
            const podName = pod.metadata!.name!
            self.visNetworkNodes.add({ id: podName, label: podName, shape: "box" })
            self.visNetworkEdges.add({ to: self.selectedNetworkNodeId, from: podName, length: count })
            count += 100
            self.visNetwork.redraw()
        })

        self.podWatcher.on("ADDED", (pod) => {
            const podName = pod.metadata!.name!
            self.visNetworkNodes.add({ id: podName, label: podName, shape: "box" })
            self.visNetworkEdges.add({ to: self.selectedNetworkNodeId, from: podName })
            self.visNetwork.redraw()
            console.log(`added ${podName}`)
        })

        // TODO change colours based on health
        self.podWatcher.on("MODIFIED", (pod) => {
            const podName = pod.metadata!.name!
            console.log(`modified ${podName}`)
        })

        self.podWatcher.on("DELETED", (pod) => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.remove(podName)
            self.visNetworkEdges.remove(podName)
            self.visNetwork.redraw()
            console.log(`deleted ${podName}`)
        })
    }

    public stopNamespaceView() {
        this.namespaceWatcher.removeAllWatchableEventListeners()
        this.visNetworkEdges.clear()
        this.visNetworkNodes.clear()
        this.tabs.clear()
    }

    public showNamespaceView() {
        const self = this

        self.state = NamespaceViewerStates.namespaces

        const helloTab = this.tabs.addTab("log")
        helloTab.addText("namespaces 1 2 3")

        // create a cluster node to be connected to everything, this makes the network stabilization faster
        self.visNetworkNodes.add({id: self.clusterVisNodeId, label: self.clusterVisNodeId, color: self.rootColour  })
        self.visNetwork.redraw()

        // selectedNetworkNodeId is holding the node name, so we want all pods on that node
        const namespaces = Array.from(self.namespaceWatcher.getCached().values())
        namespaces.forEach((node) => {
            const namespaceName = node.metadata!.name!
            self.visNetworkNodes.add({ id: namespaceName, label: namespaceName, shape: "box" })
            self.visNetworkEdges.add({ from: self.clusterVisNodeId, to: namespaceName })
            self.visNetwork.redraw()
            console.log(`added ${namespaceName}`)
        })

        self.namespaceWatcher.on("ADDED", (node) => {
            const nodeName = node.metadata!.name!
            self.visNetworkNodes.add({ id: nodeName, label: nodeName,  shape: "box" })
            self.visNetworkEdges.add({ from: self.clusterVisNodeId, to: nodeName })
            self.visNetwork.redraw()
        })

        // TODO change colour based on status
        self.namespaceWatcher.on("MODIFIED", (node) => {
            const nodeName = node.metadata!.name!
            console.log(`modified ${nodeName}`)
        })

        self.namespaceWatcher.on("DELETED", (node) => {
            const nodeName = node.metadata!.name!
            self.visNetworkNodes.remove(nodeName)
            self.visNetworkEdges.remove(nodeName)
            self.visNetwork.redraw()
            console.log(`deleted ${nodeName}`)
        })
    }
}
