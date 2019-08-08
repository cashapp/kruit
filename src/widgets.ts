import * as $ from "jquery"
import { tsImportEqualsDeclaration } from "@babel/types";

export class Tabs {

    private parentContainer: HTMLDivElement
    private element: HTMLDivElement
    private tabCount = 0

    constructor(parentContainer: HTMLDivElement) {
        if (!parentContainer) {
            throw new Error("container must be defined and not null")
        }
        this.parentContainer = parentContainer

        $("head").append(`
            <style>
                .tabs {
                    position: relative;
                    clear: both;
                    margin: 25px 0;
                }
                .tab {
                    float: left;
                }
                .tab label {
                    background: #eee;
                    padding: 10px;
                    border: 1px solid #ccc;
                    margin-left: -1px;
                    position: relative;
                    left: 1px;
                }
                .tab [type=radio] {
                    display: none;
                }
                .content {
                    position: absolute;
                    top: 28px;
                    left: 0;
                    background: white;
                    right: 0;
                    bottom: 0;
                    padding: 20px;
                    border: 1px solid #ccc;
                    overflow-y: scroll;
                }
                [type=radio]:checked ~ label {
                    background: white;
                    border-bottom: 1px solid white;
                    z-index: 2;
                }
                [type=radio]:checked ~ label ~ .content {
                    z-index: 1;
                }
            </style>
        `)
        $(parentContainer).append(`<div class="tabs" style="height: 100%"/>`)
        this.element = $(parentContainer).find(".tabs").get(0)

    }

    public addTab(label: string): Tab {
        const tabCount = this.tabCount++
        return new Tab(this.element, tabCount, label)
    }

    public clear() {
        this.tabCount = 0
        this.element.innerHTML = ""
    }
}

export class Tab {
    parentContainer: HTMLDivElement
    id: number
    textArea: HTMLTextAreaElement

    constructor(parentContainer: HTMLDivElement, id: number, label: string) {
        if (!parentContainer) {
            throw new Error("container must be defined and not null")
        }
        this.parentContainer = parentContainer

        this.id = id

        $(parentContainer).append(`
            <div class="tab" id="tab-${id}">
                <input type="radio" id="tab-input-${id}" name="tab-group-1" checked>
                <label for="tab-input-${id}">${label}</label>

                <div class="content">
                    <textarea style="width: 100%; height: 100%;" readonly/>
                </div>
            </div>
        `)
        this.textArea = $(`#tab-${this.id} textarea`).get(0) as HTMLTextAreaElement
    }

    public addText(text: string) {
        this.textArea.value += text
    }
}
