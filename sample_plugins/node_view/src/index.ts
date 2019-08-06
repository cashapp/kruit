import { Kubernetes, KubernetesClientFactory, Watcher} from 'clustermuck';
import * as http from "http"

// TODO there should be type bendings in the near future, add them once they're available
import * as vis from "vis"
import { stringLiteral } from '@babel/types';
import { V1APIGroup, V1ObjectMeta } from '@kubernetes/client-node';


export = (context: any): void => {
    // our vis graph nodes
    let idCount = 0
    const clusterVisNodeId: number = idCount
    const visNodes: vis.DataSet<vis.Node>  = new vis.DataSet([])
    const visEdges: vis.DataSet<vis.Edge> = new vis.DataSet([])

    // TODO some documentation here
    const factory = new KubernetesClientFactory()

    // TODO make this a different colour
    // TODO get the actual name of the cluster somehow
    // create a cluster node to be connected to everything, this makes the network stabilization faster
    visNodes.add({id: clusterVisNodeId, label: factory.getKubeConfig().currentContext, color: "#f7da00"  })
    
    const allNodes = new Map<string, number>()

    const coreClient = factory.getClient(Kubernetes.CoreV1Api)
    coreClient.listNode().catch((err: any) => {
        console.log(err)
    }).then( ( res ) => {
        if (!res) {
            // TODO throw error, this should never happen
            return
        }

        const { body: nodeList } = res as { response: http.IncomingMessage; body: Kubernetes.V1NodeList }

        for (let node of nodeList.items) {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            visNodes.add({ id: ++idCount, label: nodeName,  shape: "box" })
            allNodes.set(nodeName, idCount)
            visEdges.add({ id: idCount, from: clusterVisNodeId, to: idCount })
        }

    })

   // create a network
    const container = document.getElementById("container") as HTMLElement
    const data = {
        edges: visEdges,
        nodes: visNodes,
    }
    const options: vis.Options = {}
    const network = new vis.Network(container, data, options)
    const nodeWatcher = Watcher.newIWatcher(factory.getKubeConfig(), Kubernetes.V1Node)
    nodeWatcher.on("ADDED", (node) => {
        const metadata = node["metadata"] as V1ObjectMeta
        const nodeName = metadata.name as string
        visNodes.add({ id: ++idCount, label: nodeName,  shape: "box" })
        allNodes.set(nodeName, idCount)
        visEdges.add({ id: idCount, from: clusterVisNodeId, to: idCount })
    })

    nodeWatcher.on("DELETED", (node) => {
        const metadata = node["metadata"] as V1ObjectMeta
        const nodeName = metadata.name as string
        const id = allNodes.get(nodeName) as number    
        visNodes.remove(id)
        visEdges.remove(id)
    })
}
