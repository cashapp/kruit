import { V1ObjectMeta, KubeConfig, V1Node, V1Pod, V1PodSpec } from '@kubernetes/client-node';
import { Kubernetes, KubernetesClientFactory, IWatcher, Watcher, newKubeConfig } from 'clustermuck';
import * as http from "http"

// TODO there should be type definitions in the near future, add them once they're available
import * as vis from "vis"
import { removeAllListeners } from 'cluster';

export = (context: any): void => {
    const nodeViewer = new NodeViewer()
}

// NodeViewerStateType defines the states that the node viewer can be in
type NodeViewerStateType = "pods" | "nodes"

enum NodeViewerStates {
    pods = "pods",
    nodes = "nodes",
}

class NodeViewer {    
    kubeConfig = newKubeConfig()
    clusterVisNodeId = this.kubeConfig.currentContext
    state: "pods" | "nodes" = NodeViewerStates.nodes
    visNetworkNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    visNetworkEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])
    nodeWatcher: IWatcher<Kubernetes.V1Node>
    podWatcher: IWatcher<Kubernetes.V1Pod>
    container = document.getElementById("container") as HTMLElement    
    network: vis.Network = new vis.Network(this.container, { nodes: this.visNetworkNodes, edges: this.visNetworkEdges}, {
        layout: {
            improvedLayout: true,
        }
    })
    selectedNetworkNodeId: string = this.clusterVisNodeId
    rootColour = "#f7da00"

    constructor() {
        const self = this
       
        // setup node watcher
        this.nodeWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Node)
        self.nodeWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })
        
        // setup pod watcher
        this.podWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Pod)
        self.podWatcher.on("error", (err) => {
            //TODO better error handling
            console.log(err)
        })

        self.network.on("selectNode", (params) => {
            self.selectedNetworkNodeId = self.network.getNodeAt(params.pointer.DOM) as string
            switch (self.state) {
                case NodeViewerStates.nodes:
                    // switch to pod view if we've selected a node
                    if (self.selectedNetworkNodeId != self.clusterVisNodeId) {
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

        self.showNodeView()
    }


    stopPodView() {
        this.podWatcher.removeAllWatchableEventListeners()
        this.visNetworkEdges.clear()
        this.visNetworkNodes.clear()
    }

    showPodView() {
        const self = this
        self.state = NodeViewerStates.pods     

        self.visNetworkNodes.add({id: self.selectedNetworkNodeId, label: self.selectedNetworkNodeId, color: "#f7da00" })
        self.network.redraw()

        // selectedNetworkNodeId is holding the node name, so we want all pods on that node
        const pods = Array.from(self.podWatcher.getCached().values()).filter(pod => (pod.spec as V1PodSpec).nodeName == self.selectedNetworkNodeId)
        let count = 100
        pods.forEach(pod => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.add({ id: podName, label: podName, shape: "box" })
            self.visNetworkEdges.add({ to: self.selectedNetworkNodeId, from: podName, length: count })
            count += 100
            self.network.redraw()
        })   

        self.podWatcher.on("ADDED", (pod) => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.add({ id: podName, label: podName, shape: "box" })
            self.visNetworkEdges.add({ to: self.selectedNetworkNodeId, from: podName })
            self.network.redraw()            
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
            self.network.redraw()
            console.log(`deleted ${podName}`)
        })
    }

    stopNodeView() {
        this.nodeWatcher.removeAllWatchableEventListeners()
        this.visNetworkEdges.clear()
        this.visNetworkNodes.clear()
    }

    showNodeView() {
        const self = this

        self.state = NodeViewerStates.nodes          
 
        // create a cluster node to be connected to everything, this makes the network stabilization faster
        self.visNetworkNodes.add({id: self.clusterVisNodeId, label: self.clusterVisNodeId, color: self.rootColour  })
        self.network.redraw()

        // selectedNetworkNodeId is holding the node name, so we want all pods on that node
        const nodes = Array.from(self.nodeWatcher.getCached().values())
        nodes.forEach(node => {
            const nodeName = (node.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.add({ id: nodeName, label: nodeName, shape: "box" })
            self.visNetworkEdges.add({ from: self.clusterVisNodeId, to: nodeName })
            self.network.redraw()
            console.log(`added ${nodeName}`)
        })   

        self.nodeWatcher.on("ADDED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            self.visNetworkNodes.add({ id: nodeName, label: nodeName,  shape: "box" })
            self.visNetworkEdges.add({ from: self.clusterVisNodeId, to: nodeName })
            self.network.redraw()
        })

        // TODO change colour based on status
        self.nodeWatcher.on("MODIFIED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            console.log(`modified ${nodeName}`)
        })

        self.nodeWatcher.on("DELETED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string          
            self.visNetworkNodes.remove(nodeName)
            self.visNetworkEdges.remove(nodeName)
            self.network.redraw()
            console.log(`deleted ${nodeName}`)
        })
    }
}
