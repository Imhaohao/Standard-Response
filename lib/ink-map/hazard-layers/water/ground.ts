import { terrainHeight, type InkMapData, type Point } from "../../data";

// The ground's absolute elevation at a map point, in the terrain's datum: what groundElevation() gives
// the shader.
export const groundAt = (data: InkMapData, [x, y]: Point) => terrainHeight(data.terrain, x, y) + data.terrain.base;
