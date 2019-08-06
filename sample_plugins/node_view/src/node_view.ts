import { V1ObjectMeta, KubeConfig, V1Node, V1Pod } from '@kubernetes/client-node';
import { Kubernetes, KubernetesClientFactory, Watcher, newKubeConfig } from 'clustermuck';
import * as http from "http"

// TODO there should be type definitions in the near future, add them once they're available
import * as vis from "vis"

export = (context: any): void => {
    const nodeViewer = new NodeViewer()
}

class NodeViewer {
    kubeConfig = newKubeConfig()
    visNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    visEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])
    allNodes = new Map<string, V1Node>()
    allPods = new Map<string, V1Pod>()
    container = document.getElementById("container") as HTMLElement    
    network: vis.Network = new vis.Network(this.container, { nodes: this.visNodes, edges: this.visEdges}, {})

    constructor() {
        const self = this

        const clusterVisNodeId = self.kubeConfig.currentContext
        // TODO make this a different colour
        // TODO get the actual name of the cluster somehow
        // create a cluster node to be connected to everything, this makes the network stabilization faster
        self.visNodes.add({id: clusterVisNodeId, label:clusterVisNodeId, color: "#f7da00"  })

        // setup node watcher
        const nodeWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Node)
        nodeWatcher.on("error", (err) => {
            // TODO better error handling
            console.log(err)
        })

        nodeWatcher.on("ADDED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            self.visNodes.add({ id: nodeName, label: nodeName,  shape: "box" })
            self.allNodes.set(nodeName, node)
            self.visEdges.add({ id: nodeName, from: clusterVisNodeId, to: nodeName })
        })

        nodeWatcher.on("DELETED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            if (!self.allNodes.has(nodeName)) {
                console.log(`unknown node: ${nodeName}`)
                return
            }
            self.visNodes.remove(nodeName)
            self.visEdges.remove(nodeName)
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
            alert(self.network.getNodeAt(params.pointer.DOM))
        })
    }
}
