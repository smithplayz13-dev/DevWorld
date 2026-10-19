import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildTileScene } from "./tileScene";
import type { DecodedInstance } from "../streaming/decode";

describe("streamed file architecture", () => {
  it("creates pickable GPU instances and skips existing detailed buildings", () => {
    const file: DecodedInstance = {
      position: [1, 0, 0],
      scale: [0.02, 0.04, 0.02],
      material: "building",
      pick: 0,
      flags: 0,
    };
    const scene = buildTileScene(
      [file, { ...file, pick: 1 }, { ...file, material: "state", pick: 2 }],
      ["file-a", "file-b", "state"],
      new Set(["file-b"]),
    );
    expect(scene.userData.entityIds).toEqual(["file-a"]);
    expect(scene.children).toHaveLength(3);
    const body = scene.children[0] as THREE.InstancedMesh;
    expect(body.isInstancedMesh).toBe(true);
    expect(body.count).toBe(1);
    expect(body.userData.picks).toEqual(["file-a"]);
    const matrix = new THREE.Matrix4();
    body.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).length()).toBeGreaterThan(1);
    for (const mesh of scene.children as THREE.InstancedMesh[]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
});
