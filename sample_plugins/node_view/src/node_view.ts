import { V1ObjectMeta, KubeConfig, V1Node, V1Pod, V1PodSpec } from '@kubernetes/client-node';
import { Kubernetes, KubernetesClientFactory, IWatcher, Watcher, newKubeConfig } from 'clustermuck';
import $ from 'jquery';
import * as http from "http"

// TODO there should be type definitions in the near future, add them once they're available
import * as vis from "vis"
import { removeAllListeners } from 'cluster';

// This launches the plugin
export = (context: any): void => {
    $("head").append(`<link href="node_modules/vis/dist/vis-network.min.css" rel="stylesheet" type="text/css" />`)
    $("head").append(`
        <style>
            .tabs {
                position: relative;   
                height: 50%;
                clear: both;
                margin: 25px 0;
            }
            .tab {
                float: left;
            }
            .tab label {
                background: #eee; 
                padding: 10px; 
                border: 1px solid #ccc; 
                margin-left: -1px; 
                position: relative;
                left: 1px; 
            }
            .tab [type=radio] {
                display: none;   
            }
            .content {
                position: absolute;
                top: 28px;
                left: 0;
                background: white;
                right: 0;
                bottom: 0;
                padding: 20px;
                border: 1px solid #ccc; 
                overflow-y: scroll;
            }
            [type=radio]:checked ~ label {
                background: white;
                border-bottom: 1px solid white;
                z-index: 2;
            }
            [type=radio]:checked ~ label ~ .content {
                z-index: 1;
            }
        </style>
    `)
    $("#container").append(`
        <div id="top" style="height: 50%"/>
        <div id="bottom" class = "tabs" style="height: 50%">
            <div class="tab">
                <input type="radio" id="tab-1" name="tab-group-1" checked>
                <label for="tab-1">Tab One</label>
                
                <div class="content">
                    <textarea style="width: 100%; height: 100%;">
                    </textarea>
                </div> 
            </div>
        </div>    
    `)
    const nodeViewer = new NodeViewer("top")
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
    containerElement: HTMLElement
    visNetwork: vis.Network
    selectedNetworkNodeId: string = this.clusterVisNodeId
    rootColour = "#f7da00"

    constructor(container: string) {
        const self = this
       
        this.containerElement = document.getElementById(container) as HTMLElement    

        this.visNetwork = new vis.Network(this.containerElement, { nodes: this.visNetworkNodes, edges: this.visNetworkEdges}, {
            layout: {
                improvedLayout: true,
            }
        })

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

        self.visNetwork.on("selectNode", (params) => {
            self.selectedNetworkNodeId = self.visNetwork.getNodeAt(params.pointer.DOM) as string
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
        self.visNetwork.redraw()

        // selectedNetworkNodeId is holding the node name, so we want all pods on that node
        const pods = Array.from(self.podWatcher.getCached().values()).filter(pod => (pod.spec as V1PodSpec).nodeName == self.selectedNetworkNodeId)
        let count = 100
        pods.forEach(pod => {
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
        self.visNetwork.redraw()

        // selectedNetworkNodeId is holding the node name, so we want all pods on that node
        const nodes = Array.from(self.nodeWatcher.getCached().values())
        nodes.forEach(node => {
            const nodeName = (node.metadata as V1ObjectMeta).name as string
            self.visNetworkNodes.add({ id: nodeName, label: nodeName, shape: "box" })
            self.visNetworkEdges.add({ from: self.clusterVisNodeId, to: nodeName })
            self.visNetwork.redraw()
            console.log(`added ${nodeName}`)
        })   

        self.nodeWatcher.on("ADDED", (node) => {
            const metadata = node["metadata"] as V1ObjectMeta
            const nodeName = metadata.name as string
            self.visNetworkNodes.add({ id: nodeName, label: nodeName,  shape: "box" })
            self.visNetworkEdges.add({ from: self.clusterVisNodeId, to: nodeName })
            self.visNetwork.redraw()
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
            self.visNetwork.redraw()
            console.log(`deleted ${nodeName}`)
        })
    }
}
