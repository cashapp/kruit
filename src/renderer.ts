import { WebviewTag } from "electron"
import TabGroup = require("electron-tabs")
import * as fs from "fs"
import * as $ from "jquery"
import * as os from "os"
import { KubernetesClientFactory } from "./kubernetes/client_factory"

async function loadPLugins() {

  const tabGroup = new TabGroup({})

  // look in ~/.kruit/plgins by default unless KRUIT_PLUGIN_DIR is set
  const base = process.env["KRUIT_PLUGIN_DIR"] ? process.env["KRUIT_PLUGIN_DIR"] : `${os.homedir()}/.kruit/plugins`

  const pluginDirPaths = fs.readdirSync(base)
  const clientFactory = new KubernetesClientFactory()

  let tabCount = 0
  for (const subPath of pluginDirPaths) {
    const fullPath = `${base}/${subPath}`

    // skip anything that isn't a dir
    if (!fs.statSync(fullPath).isDirectory()) {
      continue
    }

    const tab = tabGroup.addTab({
      active: true,
      src: "./tab.html",
      title: subPath,
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
        const module = `${base}/${subPath}`
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
