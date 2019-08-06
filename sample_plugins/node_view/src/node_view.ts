import { V1ObjectMeta } from '@kubernetes/client-node';
import { Kubernetes, KubernetesClientFactory, Watcher} from 'clustermuck';
import * as http from "http"

// TODO there should be type definitions in the near future, add them once they're available
import * as vis from "vis"

export = (context: any): void => {
    const nodeViewer = new NodeViewer()
}

class NodeViewer {
    idCount = 0   
    visNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    visEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])
    allNodes = new Map<string, number>()
    container = document.getElementById("container") as HTMLElement    
    network: vis.Network = new vis.Network(this.container, { nodes: this.visNodes, edges: this.visEdges}, {})

    constructor() {        
        const self = this
        // our vis graph nodes
        const clusterVisNodeId: number = self.idCount

        // TODO some documentation here
        const factory = new KubernetesClientFactory()

        // TODO make this a different colour
        // TODO get the actual name of the cluster somehow
        // create a cluster node to be connected to everything, this makes the network stabilization faster
        self.visNodes.add({id: clusterVisNodeId, label: factory.getKubeConfig().currentContext, color: "#f7da00"  })

        const nodeWatcher = Watcher.newIWatcher(factory.getKubeConfig(), Kubernetes.V1Node)
        nodeWatcher.on("ADDED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            self.visNodes.add({ id: ++self.idCount, label: nodeName,  shape: "box" })
            self.allNodes.set(nodeName, self.idCount)
            self.visEdges.add({ id: self.idCount, from: clusterVisNodeId, to: self.idCount })
        })

        nodeWatcher.on("DELETED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            const id = self.allNodes.get(nodeName) as number    
            self.visNodes.remove(id)
            self.visEdges.remove(id)
        })

        self.network.on("click", (params) => {
            alert(self.network.getNodeAt(params.pointer.DOM))
        })
    }
}
