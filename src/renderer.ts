import { WebviewTag } from "electron"
import TabGroup = require("electron-tabs")
import * as fs from "fs"
import * as $ from "jquery"
import * as os from "os"
import { KubernetesClientFactory } from "./kubernetes/client_factory"

async function loadPLugins() {

  const tabGroup = new TabGroup({})

  // TODO need to support an override for plugin dir...
  const base = `${os.homedir()}/.kuitk/plugins`
  const pluginDirs = fs.readdirSync(base)
  const clientFactory = new KubernetesClientFactory()

  let tabCount = 0
  for (const dir of pluginDirs) {
      const tab = tabGroup.addTab({
        active: true,
        src: "./tab.html",
        title: dir,
        visible: true,
        webviewAttributes: {
          enableremotemodule: true,
          nodeintegration: true,
        },
      })
      await new Promise((resolve, reject) => {
        const webview: WebviewTag = $("webview").get(tabCount++) as WebviewTag
        webview.addEventListener("dom-ready", () => {
          webview.openDevTools()
          const module = `${base}/${dir}`
          webview.executeJavaScript("launchPlugin('" + module + "')")
          resolve()
        })
      })

      // NB(gflarity) wait a second here so that the UI can settle for this tab. This is is a
      // hack for for the old version of vis network the samples are currently using and it
      // should be removed later.
      await new Promise((resolve) => {
        setTimeout(resolve, 1000)
      })
  }
}

loadPLugins()
