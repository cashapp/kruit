import { app, BrowserWindow, ipcMain } from "electron"
import * as os from "os"
import * as path from "path"
import * as yargs from "yargs"

yargs.env("KUBECONFIG").option("c", {
  describe: "the kubeconfig file for this session",
  alias: "kubeconfig",
  default: os.homedir() + "/.kube/config",
  } as yargs.Options)

let mainWindow: Electron.BrowserWindow

function createWindow() {
  // Create the browser window.

  mainWindow = new BrowserWindow({
    height: 600,
    width: 800,
    // tslint:disable-next-line: object-literal-sort-keys
    webPreferences: {
      nodeIntegration: true,
      webviewTag: true,
      devTools: true,
    },
  })

  mainWindow.maximize()

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, "../index.html"))

  // Open the DevTools.
  // TODO put this behind a flag instead of a comment
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on("closed", () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow)

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  // On OS X it"s common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
// Listen for logging events
