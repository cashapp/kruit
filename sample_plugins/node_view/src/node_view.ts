import { V1ObjectMeta, KubeConfig } from '@kubernetes/client-node';
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
    allNodes = new Map<string, string>()
    container = document.getElementById("container") as HTMLElement    
    network: vis.Network = new vis.Network(this.container, { nodes: this.visNodes, edges: this.visEdges}, {})

    constructor() {
        const self = this

        const clusterVisNodeId = self.kubeConfig.currentContext
        // TODO make this a different colour
        // TODO get the actual name of the cluster somehow
        // create a cluster node to be connected to everything, this makes the network stabilization faster
        self.visNodes.add({id: clusterVisNodeId, label:clusterVisNodeId, color: "#f7da00"  })

        const nodeWatcher = Watcher.newIWatcher(self.kubeConfig, Kubernetes.V1Node)
        nodeWatcher.on("ADDED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            self.visNodes.add({ id: nodeName, label: nodeName,  shape: "box" })
            self.allNodes.set(nodeName, nodeName)
            self.visEdges.add({ id: nodeName, from: clusterVisNodeId, to: nodeName })
        })

        nodeWatcher.on("DELETED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            const id = self.allNodes.get(nodeName) as string
            self.visNodes.remove(id)
            self.visEdges.remove(id)
        })

        self.network.on("click", (params) => {
            alert(self.network.getNodeAt(params.pointer.DOM))
        })
    }
}
