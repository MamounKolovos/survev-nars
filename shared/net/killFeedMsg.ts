import type { AbstractMsg, BitStream } from "./net";

/**
 * color: green, red, etc
 *
 * background: linear-gradient(to right, red, blue)
 *
 * backgroundColor: green, red, etc
 *
 * textDecoration: underline, strikethrough
 *
 * fontWeight: bold
 *
 * fontStyle: italics
 */
export const styleKeys = [
    "color",
    "background",
    "backgroundColor",
    "textDecoration",
    "fontWeight",
    "fontStyle",
] as const;

type StyleObj = Record<(typeof styleKeys)[number], string>;
export type KillFeedStyleObj = Partial<StyleObj>;

export interface KillFeedSegment {
    text: string;
    style: KillFeedStyleObj;
}

function getFlags(style: KillFeedStyleObj) {
    let flags = 0;
    for (let i = 0; i < styleKeys.length; i++) {
        const key = styleKeys[i];
        if (key in style) {
            flags |= 1 << i;
        }
    }
    return flags;
}

export type KillFeedTarget =
    | { kind: "all" }
    | { kind: "player"; id: number }
    | { kind: "group"; id: number }
    | { kind: "team"; id: number };

export class KillFeedMsg implements AbstractMsg {
    segments: KillFeedSegment[] = [];
    target: KillFeedTarget = { kind: "all" };

    serialize(s: BitStream) {
        s.writeUint8(this.segments.length);
        for (let i = 0; i < this.segments.length; i++) {
            const segment = this.segments[i];
            s.writeASCIIString(segment.text);

            s.writeUint8(getFlags(segment.style));
            for (let j = 0; j < styleKeys.length; j++) {
                const key = styleKeys[j];
                if (segment.style[key] !== undefined) {
                    s.writeASCIIString(segment.style[key]);
                }
            }
        }

        switch (this.target.kind) {
            case "all":
                s.writeUint8(0);
                break;
            case "player":
                s.writeUint8(1);
                s.writeUint16(this.target.id);
                break;
            case "group":
                s.writeUint8(2);
                s.writeUint8(this.target.id);
                break;
            case "team":
                s.writeUint8(3);
                s.writeUint8(this.target.id);
                break;
        }
    }

    deserialize(s: BitStream) {
        const segmentCount = s.readUint8();
        for (let i = 0; i < segmentCount; i++) {
            const segment = { style: {} } as KillFeedSegment;
            segment.text = s.readASCIIString();

            const flags = s.readUint8();
            for (let j = 0; j < styleKeys.length; j++) {
                if (((flags >> j) & 1) == 1) {
                    segment.style[styleKeys[j]] = s.readASCIIString();
                }
            }

            this.segments.push(segment);
        }

        let target: KillFeedTarget;
        const kind = s.readUint8();
        switch (kind) {
            case 0:
                target = { kind: "all" };
                break;
            case 1:
                target = { kind: "player", id: s.readUint16() };
                break;
            case 2:
                target = { kind: "group", id: s.readUint8() };
                break;
            case 3:
                target = { kind: "team", id: s.readUint8() };
                break;
            default:
                throw new Error(`unknown KillFeedTarget kind: ${kind}`);
        }
        this.target = target;
    }
}
