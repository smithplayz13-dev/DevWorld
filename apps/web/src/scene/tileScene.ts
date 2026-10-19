import * as THREE from "three";
import type { DecodedInstance } from "../streaming/decode";

/** Draw coarse file architecture from verified tiles; semantic cutaways remain
 * owned by the inspected hierarchy. Roof rails/windows are decorative details,
 * not invented floors, functions or dependency edges. */
export function buildTileScene(
  instances: DecodedInstance[],
  picks: string[],
  represented: ReadonlySet<string>,
): THREE.Group {
  const group = new THREE.Group();
  const buildings = instances.filter(
    (item) => item.material === "building" && !represented.has(picks[item.pick]),
  );
  if (!buildings.length) return group;
  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const bodies = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: "#2f8292",
      roughness: 0.5,
      metalness: 0.4,
      emissive: "#103b45",
      emissiveIntensity: 0.3,
    }),
    buildings.length,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.04, 1),
    new THREE.MeshBasicMaterial({ color: "#a6f4ec" }),
    buildings.length,
  );
  const rings = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.01, 0.014, 1.01),
    new THREE.MeshBasicMaterial({ color: "#62c6cb" }),
    buildings.length * 3,
  );
  const ids: string[] = [];
  buildings.forEach((item, i) => {
    const normal = new THREE.Vector3(...item.position).normalize();
    rotation.setFromUnitVectors(up, normal);
    position.copy(normal).multiplyScalar(Math.max(1.023, Math.hypot(...item.position)));
    // Small urban glyphs stay legible without implying additional entities.
    scale.set(item.scale[0] * 0.42, item.scale[1] * 1.35, item.scale[2] * 0.42);
    matrix.compose(position, rotation, scale);
    bodies.setMatrixAt(i, matrix);
    matrix.compose(position.clone().addScaledVector(normal, scale.y), rotation, scale);
    crowns.setMatrixAt(i, matrix);
    for (let band = 0; band < 3; band++) {
      matrix.compose(
        position.clone().addScaledVector(normal, (scale.y * (band + 1)) / 4),
        rotation,
        scale,
      );
      rings.setMatrixAt(i * 3 + band, matrix);
    }
    ids.push(picks[item.pick]);
  });
  bodies.userData.picks = ids;
  crowns.userData.picks = ids;
  rings.userData.picks = ids.flatMap((id) => [id, id, id]);
  for (const mesh of [bodies, crowns, rings]) {
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  group.userData.entityIds = ids;
  return group;
}
