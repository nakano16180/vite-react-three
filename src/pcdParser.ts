/**
 * PCD (Point Cloud Data) file parser
 * Supports ASCII and Binary PCD formats
 */

export interface PointCloudPoint {
  x: number;
  y: number;
  z: number;
  r?: number; // RGB color values (0-255)
  g?: number;
  b?: number;
  intensity?: number;
}

export interface PointCloudData {
  points: PointCloudPoint[];
  header: {
    version: string;
    fields: string[];
    size: number[];
    type: string[];
    count: number[];
    width: number;
    height: number;
    viewpoint: number[];
    points: number;
    data: string;
  };
}

export function parsePCDFile(fileContent: string): PointCloudData | null {
  try {
    const lines = fileContent.split('\n');
    let dataStartIndex = -1;
    
    // Parse header
    const header = {
      version: '',
      fields: [] as string[],
      size: [] as number[],
      type: [] as string[],
      count: [] as number[],
      width: 0,
      height: 0,
      viewpoint: [] as number[],
      points: 0,
      data: ''
    };

    // Find header fields
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#') || line === '') continue;
      
      if (line.startsWith('VERSION')) {
        header.version = line.split(' ')[1];
      } else if (line.startsWith('FIELDS')) {
        header.fields = line.split(' ').slice(1);
      } else if (line.startsWith('SIZE')) {
        header.size = line.split(' ').slice(1).map(Number);
      } else if (line.startsWith('TYPE')) {
        header.type = line.split(' ').slice(1);
      } else if (line.startsWith('COUNT')) {
        header.count = line.split(' ').slice(1).map(Number);
      } else if (line.startsWith('WIDTH')) {
        header.width = parseInt(line.split(' ')[1]);
      } else if (line.startsWith('HEIGHT')) {
        header.height = parseInt(line.split(' ')[1]);
      } else if (line.startsWith('VIEWPOINT')) {
        header.viewpoint = line.split(' ').slice(1).map(Number);
      } else if (line.startsWith('POINTS')) {
        header.points = parseInt(line.split(' ')[1]);
      } else if (line.startsWith('DATA')) {
        header.data = line.split(' ')[1];
        dataStartIndex = i + 1;
        break;
      }
    }

    if (dataStartIndex === -1 || header.data !== 'ascii') {
      console.warn('Only ASCII PCD format is supported');
      return null;
    }

    // Parse point data
    const points: PointCloudPoint[] = [];
    const fieldIndexes = {
      x: header.fields.indexOf('x'),
      y: header.fields.indexOf('y'),
      z: header.fields.indexOf('z'),
      r: header.fields.indexOf('r'),
      g: header.fields.indexOf('g'),
      b: header.fields.indexOf('b'),
      rgb: header.fields.indexOf('rgb'),
      intensity: header.fields.indexOf('intensity')
    };

    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') continue;
      
      const values = line.split(/\s+/).map(Number);
      if (values.length < header.fields.length) continue;

      const point: PointCloudPoint = {
        x: fieldIndexes.x >= 0 ? values[fieldIndexes.x] : 0,
        y: fieldIndexes.y >= 0 ? values[fieldIndexes.y] : 0,
        z: fieldIndexes.z >= 0 ? values[fieldIndexes.z] : 0
      };

      // Handle color information
      if (fieldIndexes.r >= 0 && fieldIndexes.g >= 0 && fieldIndexes.b >= 0) {
        point.r = values[fieldIndexes.r];
        point.g = values[fieldIndexes.g];
        point.b = values[fieldIndexes.b];
      } else if (fieldIndexes.rgb >= 0) {
        // Handle packed RGB
        const rgb = values[fieldIndexes.rgb];
        point.r = (rgb >> 16) & 0xFF;
        point.g = (rgb >> 8) & 0xFF;
        point.b = rgb & 0xFF;
      }

      if (fieldIndexes.intensity >= 0) {
        point.intensity = values[fieldIndexes.intensity];
      }

      points.push(point);
    }

    return { points, header };
  } catch (error) {
    console.error('Error parsing PCD file:', error);
    return null;
  }
}