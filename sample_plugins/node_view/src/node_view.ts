import { KubeConfig, V1Node, V1ObjectMeta, V1Pod, V1PodSpec } from "@kubernetes/client-node"
import { IWatcher, Kubernetes, KubernetesClientFactory, newKubeConfig, Tabs, Watcher } from "clustermuck"
import * as http from "http"
import $ from "jquery"

// TODO there should be type definitions in the near future, add them once they're available
import { removeAllListeners } from "cluster"
import * as vis from "vis"

// This launches the plugin
export = (context: any): void => {
    $("head").append(`<link href="node_modules/vis/dist/vis-network.min.css" rel="stylesheet" type="text/css" />`)
    $("#container").append(`
        <div class="node_view_top" style="height: 50%"/>
        <div class="node_view_bottom tabs" style="height: 50%"/>
    `)
    const nodeViewer = new NodeViewer($("#container").get(0) as HTMLDivElement)
}

// NodeViewerStateType defines the states that the node viewer can be in
type NodeViewerStateType = "pods" | "nodes"

enum NodeViewerStates {
    pods = "pods",
    nodes = "nodes",
}

class NodeViewer {
    public kubeConfig = newKubeConfig()
    public clusterVisNodeId = this.kubeConfig.currentContext
    public state: "pods" | "nodes" = NodeViewerStates.nodes
    public visNetworkNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    public visNetworkEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])
    public nodeWatcher: IWatcher<Kubernetes.V1Node>
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
        this.nodeWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Node)
        self.nodeWatcher.on("error", (err) => {
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
                case NodeViewerStates.nodes:
                    // switch to pod view if we've selected a node
                    if (self.selectedNetworkNodeId !== self.clusterVisNodeId) {
                        self.stopNodeView()
                        self.showPodView()
                    }
                    break
                case NodeViewerStates.pods:
                    // switch to node view if we've selected centre node
                    self.stopPodView()
                    self.showNodeView()
                    break
            }
        })

        this.showNodeView()
    }


    public stopPodView() {
        this.podWatcher.removeAllWatchableEventListeners()
        this.visNetworkEdges.clear()
        this.visNetworkNodes.clear()
        this.tabs.clear()
    }

    public showPodView() {
        const self = this
        self.state = NodeViewerStates.pods

        const helloTab = this.tabs.addTab("log")
        helloTab.addText("pods 1 2 3")

        self.visNetworkNodes.add({id: self.selectedNetworkNodeId, label: self.selectedNetworkNodeId, color: "#f7da00" })
        self.visNetwork.redraw()

        // selectedNetworkNodeId is holding the node name, so we want all pods on that node
        const pods = Array.from(self.podWatcher.getCached().values()).filter((pod) => (pod.spec as V1PodSpec).nodeName == self.selectedNetworkNodeId)
        let count = 100
        pods.forEach((pod) => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.add({ id: podName, label: podName, shape: "box" })
            self.visNetworkEdges.add({ to: self.selectedNetworkNodeId, from: podName, length: count })
            count += 100
            self.visNetwork.redraw()
        })

        self.podWatcher.on("ADDED", (pod) => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.add({ id: podName, label: podName, shape: "box" })
            self.visNetworkEdges.add({ to: self.selectedNetworkNodeId, from: podName })
            self.visNetwork.redraw()
            console.log(`added ${podName}`)
        })

        // TODO change colours based on health
        self.podWatcher.on("MODIFIED", (pod) => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
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

    public stopNodeView() {
        this.nodeWatcher.removeAllWatchableEventListeners()
        this.visNetworkEdges.clear()
        this.visNetworkNodes.clear()
        this.tabs.clear()
    }

    public showNodeView() {
        const self = this

        self.state = NodeViewerStates.nodes

        const helloTab = this.tabs.addTab("log")
        helloTab.addText("nodes 1 2 3")

        // create a cluster node to be connected to everything, this makes the network stabilization faster
        self.visNetworkNodes.add({id: self.clusterVisNodeId, label: self.clusterVisNodeId, color: self.rootColour  })
        self.visNetwork.redraw()

        // selectedNetworkNodeId is holding the node name, so we want all pods on that node
        const nodes = Array.from(self.nodeWatcher.getCached().values())
        nodes.forEach((node) => {
            const nodeName = (node.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.add({ id: nodeName, label: nodeName, shape: "box" })
            self.visNetworkEdges.add({ from: self.clusterVisNodeId, to: nodeName })
            self.visNetwork.redraw()
            console.log(`added ${nodeName}`)
        })

        self.nodeWatcher.on("ADDED", (node) => {
            const metadata = node.metadata as V1ObjectMeta
            const nodeName = metadata.name as string
            self.visNetworkNodes.add({ id: nodeName, label: nodeName,  shape: "box" })
            self.visNetworkEdges.add({ from: self.clusterVisNodeId, to: nodeName })
            self.visNetwork.redraw()
        })

        // TODO change colour based on status
        self.nodeWatcher.on("MODIFIED", (node) => {
            const metadata = node.metadata as V1ObjectMeta
            const nodeName = metadata.name as string
            console.log(`modified ${nodeName}`)
        })

        self.nodeWatcher.on("DELETED", (node) => {
            const metadata = node.metadata as V1ObjectMeta
            const nodeName = metadata.name as string
            self.visNetworkNodes.remove(nodeName)
            self.visNetworkEdges.remove(nodeName)
            self.visNetwork.redraw()
            console.log(`deleted ${nodeName}`)
        })
    }
}
