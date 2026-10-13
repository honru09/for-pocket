// Every pose uses the same cubic path commands. The original tiny face can
// therefore change shape continuously without ever drawing a second face.
const line = (x1,y1,x2,y2) => [x1+(x2-x1)/3,y1+(y2-y1)/3,x1+2*(x2-x1)/3,y1+2*(y2-y1)/3,x2,y2];
const quad = (x1,y1,cx,cy,x2,y2) => [x1+2*(cx-x1)/3,y1+2*(cy-y1)/3,x2+2*(cx-x2)/3,y2+2*(cy-y2)/3,x2,y2];
const hold = (x,y) => [x,y,x,y,x,y];
const eye = (x,y,curve) => [x,y,...curve,...hold(curve[4],curve[5])];
const eyes = (left,right) => [...left,...right];
const mouth = (x,y,curve) => [x,y,...curve,...hold(curve[4],curve[5]),...hold(curve[4],curve[5]),...hold(curve[4],curve[5])];

const openEyes = eyes(eye(45,58,line(45,58,45,65)), eye(73,55,line(73,55,73,62)));
export const EYE_POSES = [
  openEyes,
  eyes(eye(39,63,quad(39,63,45,54,51,63)),eye(69,61,quad(69,61,75,52,81,61))),
  eyes(eye(40,63,quad(40,63,45,57,50,63)),eye(70,61,quad(70,61,75,55,80,61))),
  openEyes,
  eyes(eye(40,61,line(40,61,52,61)),eye(70,59,line(70,59,82,59))),
  eyes(eye(45,62,line(45,62,45,67)),eye(74,60,line(74,60,74,65))),
  // A rounded squint reads as playful annoyance; the old sharp zig-zag made
  // the final mood look startled and harsh at small sizes.
  eyes(eye(41,61,quad(41,61,46,66,51,61)), eye(79,59,quad(79,59,74,64,69,59))),
];
export const SLEEP_EYES = eyes(eye(40,62,quad(40,62,46,67,52,62)),eye(70,60,quad(70,60,76,65,82,60)));
const smile = mouth(50,78,quad(50,78,60,88,70,75));
const k = .5522847498;
export const MOUTH_POSES = [
  smile,
  smile,
  mouth(56,79,quad(56,79,61,84,66,78)),
  [60,79,60,79-4*k,63-3*k,75,63,75,63+3*k,75,66,79-4*k,66,79,66,79+4*k,63+3*k,83,63,83,63-3*k,83,60,79+4*k,60,79],
  mouth(56,83,quad(56,83,63,80,69,82)),
  mouth(54,84,quad(54,84,63,75,71,82)),
  // Small soft pout. It keeps the angry state cute instead of becoming a
  // large angular open mouth when the cloud is rendered at 108px.
  [55,81,...quad(55,81,64,87,73,81),...quad(73,81,64,90,55,81),...hold(55,81),...hold(55,81)],
];

export function facePath(points, kind) {
  const commands = kind === 'eyes' ? [['M',2],['C',6],['C',6],['M',2],['C',6],['C',6]] : [['M',2],['C',6],['C',6],['C',6],['C',6]];
  let index = 0;
  return commands.map(([command,count]) => command + points.slice(index, index += count).map(value => +value.toFixed(3)).join(' ')).join('');
}
