// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.
import * as k8s from "@kubernetes/client-node"
import * as os from "os"
import * as process from "process"
import * as vis from "vis"

// TODO(gflarity) this is a hack that can go away after 0.10.3 is released.
import * as shelljs from "shelljs"
shelljs.config.execPath = "/usr/local/bin/node"

// TODO(gflarity) ApiContructor is defined inside @kubernetes/client-node but not exported. Ask upstream to
// just export this?
declare module "@kubernetes/client-node" {
    export type ApiConstructor<T extends k8s.ApiType> = new (server: string) => T
}

export function newKubeConfig(): k8s.KubeConfig {
    const kubeConfig = new k8s.KubeConfig()

    // TODO this should be configured in the main process and passed some how ideally
    let kubeConfigFile = `${os.homedir()}/.kube/config`
    if (process.env.KUBECONFIG !== undefined) {
        kubeConfigFile = process.env.KUBECONFIG
    }

    // TODO better error handling if the file doesn't exist
    kubeConfig.loadFromFile(kubeConfigFile)
    return kubeConfig
}

// TODO documentation for this class
export class KubernetesClientFactory {

   public kubeConfig: k8s.KubeConfig

    constructor() {
        this.kubeConfig = newKubeConfig()
    }

    public getClient<T extends k8s.ApiType>(apiClientType: k8s.ApiConstructor<T>): T {
        return this.kubeConfig.makeApiClient(apiClientType)
    }

    public getKubeConfig(): k8s.KubeConfig {
        return this.kubeConfig
    }
}

