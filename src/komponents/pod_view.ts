import { dumpYaml, KubeConfig, V1Pod } from "@kubernetes/client-node"
import { PodWrapper } from "../kubernetes/pod_wrapper"
import { Tabs } from "../widgets"
import { Komponent } from "./komponents"

export class PodView extends Komponent {

    private tabs = new Tabs(this.divContainer)

    constructor(private kubeConfig: KubeConfig, private pod: V1Pod, private divContainer: HTMLDivElement) {
        super()

        const wrappedProd = new PodWrapper(this.kubeConfig, pod!)
        const logTab = this.tabs.addTab(`yaml`)
        logTab.addText(dumpYaml(pod))

        for (const container of pod.spec.containers) {
            const logTab = this.tabs.addTab(`${container.name} logs`)
            wrappedProd.followLogs(container.name).then((stream) => {
                stream.on("data", (line) => {
                    logTab.addText(line + "\n")
                })

                // when the tab goes away the stream should stop writing to it
                logTab.on("destroy", () => {
                    stream.destroy()
                })
            }).catch((err) => {
                console.log(err)
            })
        }
    }

    public destroy() {
        this.tabs.destroy()
    }
}
