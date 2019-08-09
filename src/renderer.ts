import { WebviewTag } from "electron"
import TabGroup = require("electron-tabs")
import * as fs from "fs"
import * as $ from "jquery"
import * as os from "os"
import * as process from 'process';
import { KubernetesClientFactory } from "./kubernetes/client_factory"

function loadPLugins() {

  const tabGroup = new TabGroup({})

  // TODO need to support an override for plugin dir...
  const base = `${os.homedir()}/.clustermuck/plugins`
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


    const webview: WebviewTag = $("webview").get(tabCount++) as WebviewTag
    webview.addEventListener("dom-ready", () => {
      webview.openDevTools()
      const module = `${base}/${dir}`
      webview.executeJavaScript("launchPlugin('" + module + "')")
    })
  }
}

loadPLugins()
