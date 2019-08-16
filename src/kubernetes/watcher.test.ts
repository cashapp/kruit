import * as k8s from "@kubernetes/client-node"
import { Watcher } from "./watcher"

jest.mock("./watcher_factory")

test("something", () => {
    expect("anything").toBe("anything")
})
