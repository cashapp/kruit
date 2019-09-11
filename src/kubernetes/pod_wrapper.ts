import { KubeConfig, V1Pod } from "@kubernetes/client-node"
import * as byline from "byline"
import * as request from "request"
import { Readable } from "stream"

export class PodWrapper {
    public kubeConfig: KubeConfig
    public pod: V1Pod
    constructor(kc: KubeConfig, pod: V1Pod) {
        if (!kc) {
            throw new Error("kubbeconfig bust bbe defined not null")
        }
        this.kubeConfig = kc
        if (!pod) {
            throw new Error("pod must defined and not null")
        }
        this.pod = pod
    }

    public async followLogs(containerName: string): Promise<Readable> {
        return new Promise<Readable>((resolve, reject) => {
            const cluster = this.kubeConfig.getCurrentCluster()
            const url = cluster.server + `/api/v1/namespaces/${this.pod.metadata!.namespace}/pods/${this.pod.metadata!.name}/log?container=${containerName}`
            const headerParams: any = {}
            const reqOpts: request.OptionsWithUri = {
                method: "GET",
                qs: {
                    follow: true,
                    tailLines: 100,
                },
                headers: headerParams,
                uri: url,
                useQuerystring: true,
                // json: true,
            }
            this.kubeConfig.applyToRequest(reqOpts)

            // TODO byline was used for convienence but it has performance implications, we should stop using it
            const stream = byline.createStream()
            const req = request(reqOpts, (error, response, body) => {
                if (error) {
                    reject(error)
                } else if (response && response.statusCode !== 200) {
                    reject(new Error(response.statusMessage))
                }
            })
            req.pipe(stream)
            resolve(stream)
        })
    }
}
