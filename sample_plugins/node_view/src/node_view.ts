import { V1ObjectMeta, KubeConfig, V1Node, V1Pod, V1PodSpec } from '@kubernetes/client-node';
import { Kubernetes, KubernetesClientFactory, Watcher, newKubeConfig } from 'clustermuck';
import * as http from "http"

// TODO there should be type definitions in the near future, add them once they're available
import * as vis from "vis"

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
    allNodes = new Map<string, V1Node>()
    allPods = new Map<string, V1Pod>()
    container = document.getElementById("container") as HTMLElement    
    network: vis.Network = new vis.Network(this.container, { nodes: this.visNetworkNodes, edges: this.visNetworkEdges}, {})
    selectedNetworkNodeId: string = this.clusterVisNodeId

    constructor() {
        const self = this

        // TODO make this a different colour
        // TODO get the actual name of the cluster somehow
        // create a cluster node to be connected to everything, this makes the network stabilization faster
        self.visNetworkNodes.add({id: self.clusterVisNodeId, label: self.clusterVisNodeId, color: "#f7da00"  })

        // setup node watcher
        const nodeWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Node)
        nodeWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })

        nodeWatcher.on("ADDED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            self.visNetworkNodes.add({ id: nodeName, label: nodeName,  shape: "box" })
            self.allNodes.set(nodeName, node)
            self.visNetworkEdges.add({ id: nodeName, from: self.clusterVisNodeId, to: nodeName })
        })

        nodeWatcher.on("DELETED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            if (!self.allNodes.has(nodeName)) {
                console.log(`unknown node: ${nodeName}`)
                return
            }
            self.visNetworkNodes.remove(nodeName)
            self.visNetworkEdges.remove(nodeName)
            self.allNodes.delete(nodeName)
        })
        

        // setup pod watcher
        const podWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Pod)
        podWatcher.on("error", (err) => {
            //TODO better error handling
            console.log(err)
        })

        podWatcher.on("ADDED", (pod) => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            console.log(`adding ${podName}`)
            self.allPods.set(podName, pod)
        })

        podWatcher.on("ADDED", (pod) => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            console.log(`adding ${podName}`)
            self.allPods.set(podName, pod)
        })

        podWatcher.on("DELETED", (pod) => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            if (!self.allPods.has(podName)) {
                console.log(`unknown pod: ${podName}`)
                return
            }
            console.log(`deleting ${podName}`)
            self.allPods.delete(podName)
        })

        self.network.on("click", (params) => {
            self.selectedNetworkNodeId = self.network.getNodeAt(params.pointer.DOM) as string
            switch (self.state) {
                case NodeViewerStates.nodes:
                    // switch to pod view if we've selected a node
                    if (self.selectedNetworkNodeId != self.clusterVisNodeId) {
                        self.showPodView()
                    }
                case NodeViewerStates.pods:
                    // switch to node view if we've selected centre node
            }
        })
    }

    showPodView() {
        const self = this
        self.visNetworkEdges.clear()
        self.visNetworkNodes.clear()

        self.visNetworkNodes.add({id: self.selectedNetworkNodeId, label: self.selectedNetworkNodeId})
        // selectedNetworkNodeId is holding the node name, so we want all pods on that node
        const pods = Array.from(self.allPods.values()).filter(pod => (pod.spec as V1PodSpec).nodeName == self.selectedNetworkNodeId)
        pods.forEach(pod => {
            const podName = (pod.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.add({ id: podName, label: podName, shape: "box" })
            self.visNetworkEdges.add({ from: self.selectedNetworkNodeId, to: podName })
        })   
        self.state = NodeViewerStates.pods             
    }
}
