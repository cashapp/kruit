import * as k8s from "@kubernetes/client-node"
import { Watcher } from './watcher_factory';

jest.mock("./watcher_factory")

test("something", () => {
    expect("anything").toBe("anything")
})