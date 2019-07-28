import { WebviewTag } from "electron"
import TabGroup = require("electron-tabs")
import * as fs from "fs"
import * as os from "os"
import * as client_factory from "./kubernetes/client_factory"
import * as process from 'process';

function loadPLugins() {

  const tabGroup = new TabGroup({
    newTab: {
        title: 'New Tab'
    },
  })

  // TODO need to support an override for plugin dir...
  const base = `${os.homedir()}/.clustermuck/plugins`
  const pluginDirs = fs.readdirSync(base)
  const clientFactory = new client_factory.KubernetesClientFactory()
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

    const webview: WebviewTag = document.querySelector('webview')
    webview.addEventListener('dom-ready', () => {
      webview.openDevTools()
      const module = `${base}/${dir}`
      webview.executeJavaScript("launchPlugin('" + module + "')")
    })
  }
}

loadPLugins()
