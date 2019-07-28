import { Kubernetes, KubernetesClientFactory } from "clustermuck"
import * as http from "http"

// TODO there should be type bendings in the near future, add them once they're available
import * as visNetwork from "vis-network"

export = (context: any): void => {
    // our vis graph nodes
    let idCount = 0
    const clusterVisNodeId: number = idCount
    const visNodes: visNetwork.DataSet<visNetwork.Node>  = new visNetwork.DataSet([])
    const edges: visNetwork.DataSet<visNetwork.Edge> = new visNetwork.DataSet([])

    // TODO some documentation here
    const factory = new KubernetesClientFactory()
    // create a cluster node to be connected to everything, this makes the network stabilization faster
    // TODO make this a different colour
    // TODO get the actual name of the cluster somehow
    visNodes.add({id: clusterVisNodeId, label: factory.getKubeConfig().currentContext, color: "#f7da00"  })

    const coreClient = factory.getClient(Kubernetes.CoreV1Api)
    coreClient.listNode().catch((err: any) => {
        console.log(err)
    }).then( ( res ) => {
        if (!res) {
            // TODO throw error, this should never happen
            return
        }

        const { body: nodeList } = res as { response: http.IncomingMessage; body: Kubernetes.V1NodeList }

        nodeList.items.forEach((value, index) => {
            visNodes.add({ id: ++idCount, label: (value.metadata as Kubernetes.V1ObjectMeta).name,  shape: "box" })
            edges.add({ from: clusterVisNodeId, to: idCount })
        })
    })


   // create a network
    const container = document.getElementById("container") as HTMLElement
    const data = {
        edges,
        nodes: visNodes,
    }
    const options: visNetwork.Options = {}
    const network = new visNetwork.Network(container, data, options)
 
}
