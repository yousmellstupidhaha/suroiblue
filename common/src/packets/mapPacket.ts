import { ObjectCategory, PacketType } from "../constants";
import { Buildings, type BuildingDefinition } from "../definitions/buildings";
import { Obstacles, RotationMode, type ObstacleDefinition } from "../definitions/obstacles";
import { type Variation } from "../typings";
import { type SuroiBitStream } from "../utils/suroiBitStream";
import { type Vector } from "../utils/vector";
import { Packet } from "./packet";

type MapObject = {
    readonly position: Vector
    readonly rotation: number
    readonly scale?: number
    readonly variation?: Variation
} & ({
    readonly type: ObjectCategory.Obstacle
    readonly definition: ObstacleDefinition
} | {
    readonly type: ObjectCategory.Building
    readonly definition: BuildingDefinition
});

export class MapPacket extends Packet {
    override readonly allocBytes = 1 << 16;
    override readonly type = PacketType.Map;

    seed!: number;
    width!: number;
    height!: number;
    oceanSize!: number;
    beachSize!: number;

    rivers: Array<{ readonly width: number, readonly points: Vector[] }> = [];

    objects: MapObject[] = [];

    places: Array<{ readonly position: Vector, readonly name: string }> = [];

    override serialize(): void {
        super.serialize();
        const stream = this.stream;

        stream.writeUint32(this.seed);
        stream.writeUint16(this.width);
        stream.writeUint16(this.height);
        stream.writeUint16(this.oceanSize);
        stream.writeUint16(this.beachSize);

        stream.writeIterator(this.rivers, this.rivers.length, 4, (river) => {
            stream.writeUint8(river.width);
            stream.writeIterator(river.points, river.points.length, 8, (point) => {
                stream.writePosition(point);
            });
        });

        stream.writeIterator(this.objects, this.objects.length, 16, (object) => {
            stream.writeObjectType(object.type);
            stream.writePosition(object.position);

            switch (object.type) {
                case ObjectCategory.Obstacle: {
                    Obstacles.writeToStream(stream, object.definition);
                    stream.writeObstacleRotation(object.rotation, object.definition.rotationMode);
                    if (object.definition.variations !== undefined && object.variation !== undefined) {
                        stream.writeVariation(object.variation);
                    }
                    break;
                }
                case ObjectCategory.Building:
                    Buildings.writeToStream(stream, object.definition);
                    stream.writeObstacleRotation(object.rotation, RotationMode.Limited);
                    break;
            }
        });

        stream.writeIterator(this.places, this.places.length, 4, (place) => {
            stream.writeASCIIString(place.name);
            stream.writePosition(place.position);
        });
    }

    override deserialize(stream: SuroiBitStream): void {
        this.seed = stream.readUint32();
        this.width = stream.readUint16();
        this.height = stream.readUint16();
        this.oceanSize = stream.readUint16();
        this.beachSize = stream.readUint16();

        this.rivers = [...stream.readIterator(4, () => {
            return {
                width: stream.readUint8(),
                points: [...stream.readIterator(8, () => stream.readPosition())]
            };
        })];

        this.objects = [...stream.readIterator(16, () => {
            const type = stream.readObjectType() as ObjectCategory.Obstacle | ObjectCategory.Building;
            const position = stream.readPosition();

            switch (type) {
                case ObjectCategory.Obstacle: {
                    const definition = Obstacles.readFromStream(stream);
                    const scale = definition.scale?.spawnMax ?? 1;
                    const rotation = stream.readObstacleRotation(definition.rotationMode).rotation;

                    let variation: Variation | undefined;
                    if (definition.variations !== undefined) {
                        variation = stream.readVariation();
                    }
                    return {
                        position,
                        type,
                        definition,
                        scale,
                        rotation,
                        variation
                    };
                }
                case ObjectCategory.Building: {
                    const definition = Buildings.readFromStream(stream);
                    const { orientation } = stream.readObstacleRotation(RotationMode.Limited);

                    return {
                        position,
                        type,
                        definition,
                        rotation: orientation,
                        scale: 1
                    };
                }
            }
        })];

        this.places = [...stream.readIterator(4, () => {
            return {
                name: stream.readASCIIString(),
                position: stream.readPosition()
            };
        })];
    }
}
