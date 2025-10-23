# GitHub Copilot Instructions for vite-react-three

## Project Overview

This is a React + TypeScript + Vite application that combines 3D visualization with database functionality. The project provides an interactive drawing surface with 3D point cloud visualization capabilities using Three.js and data persistence using DuckDB.

### Key Features

- Interactive 3D drawing and visualization
- Point cloud data (PCD file) loading and rendering
- Real-time data persistence with DuckDB
- Geometric data processing with spatial extensions
- Modern React with hooks and TypeScript

## Technology Stack

- **Frontend Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7
- **3D Rendering**: Three.js with React Three Fiber (@react-three/fiber) and Drei (@react-three/drei)
- **Database**: DuckDB WASM with spatial extensions
- **Styling**: CSS with inline styles (no CSS framework)
- **Code Quality**: ESLint + Prettier
- **Deployment**: GitHub Pages via GitHub Actions

## Project Structure

```
src/
├── components/           # React components
│   ├── Box.tsx          # 3D box component
│   ├── DrawingSurface.tsx # Interactive drawing component
│   ├── Header.tsx       # UI header with controls
│   ├── PCDLoader.tsx    # Point cloud data loader
│   └── Scene.tsx        # Main 3D scene component
├── assets/              # Static assets
├── App.tsx              # Main application component
├── main.tsx             # Application entry point
├── dbBundles.ts         # DuckDB bundle configuration
└── vite-env.d.ts        # Vite type definitions
```

## Coding Standards and Patterns

### React Patterns

- Use functional components with hooks
- Prefer `useEffect` for side effects and lifecycle management
- Use TypeScript interfaces for prop definitions
- Use `useState` for local component state
- Handle async operations properly with try/catch blocks

### TypeScript Guidelines

- Define clear interfaces for all data structures
- Use proper type annotations for function parameters and return values
- Avoid `any` type - use specific types or `unknown` when necessary
- Use type guards for runtime type checking (e.g., `Number.isFinite()`)

### Three.js/React Three Fiber Patterns

- Use `Canvas` component as the root container for 3D content
- Implement components using React Three Fiber conventions
- Use `useFrame` for animation loops when needed
- Handle 3D coordinates and transformations carefully
- Use `OrbitControls` for camera interaction

### Database Integration

- Use async/await pattern for DuckDB operations
- Always handle database connection states properly
- Implement fallback mechanisms for spatial extension failures
- Use prepared statements for parameterized queries
- Clean up database resources (close connections/statements)

### Error Handling

- Wrap async operations in try/catch blocks
- Provide fallback behavior for optional features (e.g., spatial extensions)
- Display user-friendly error messages
- Log detailed errors to console for debugging

## Development Workflow

### Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Run ESLint
npm run lint:fix # Fix ESLint issues automatically
npm run format   # Format code with Prettier
npm run preview  # Preview production build
```

### Development Guidelines

1. **Start Development**: Always run `npm run dev` to start the development server
2. **Code Quality**: Run `npm run lint` and `npm run format` before committing
3. **Building**: Test production builds with `npm run build` before deploying
4. **File Loading**: Test PCD file loading functionality in browser
5. **Database Features**: Verify both spatial and JSON fallback modes work

### Testing Approach

- Test 3D rendering and interaction manually in browser
- Verify drawing functionality works correctly
- Test PCD file loading with valid files
- Verify database operations (save, load, clear, undo)
- Test both spatial and fallback modes for database operations

## Component Architecture

### App.tsx (Main Component)

- Manages DuckDB connection and initialization
- Handles spatial extension loading with fallback
- Coordinates data flow between UI and database
- Manages application state (strokes, point clouds, interaction mode)

### Components Responsibilities

- **Header**: UI controls, file input, mode switching
- **Scene**: 3D scene setup, point cloud rendering, stroke visualization
- **DrawingSurface**: Interactive drawing capture and processing
- **PCDLoader**: Point cloud data parsing and mesh generation

### State Management

- Use local component state for UI interactions
- Lift state up to App.tsx for shared data
- Use callbacks for child-to-parent communication
- Handle async state updates properly

## Database Schema and Operations

### Tables

- **strokes**: Geometric data with GEOMETRY column (when spatial extension available)
- **strokes_json**: JSON fallback for coordinate data

### Query Patterns

- Use prepared statements for data insertion
- Handle both spatial (WKT/GEOMETRY) and JSON coordinate formats
- Implement proper error handling for spatial operations
- Use transactions for related operations

## File Processing

### PCD Files

- Support standard PCD file format
- Parse header information correctly
- Handle different point data formats
- Generate appropriate Three.js geometries

### Coordinate Systems

- Store drawing coordinates in pixel space
- Handle coordinate transformations between 2D canvas and 3D space
- Use proper geometric primitives (LINESTRING for strokes)

## Performance Considerations

- Use `React.memo()` for expensive rendering operations
- Implement proper cleanup in `useEffect` hooks
- Handle large point cloud datasets efficiently
- Optimize database queries and batch operations
- Use proper Three.js disposal methods for memory management

## Common Patterns to Follow

### Async Component Initialization

```typescript
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      // async operations
      if (!cancelled) {
        // update state
      }
    } catch (error) {
      // handle error
    }
  })();
  return () => {
    cancelled = true;
  };
}, []);
```

### Database Operations

```typescript
const performDBOperation = async () => {
  if (!dbConn) return;
  try {
    const stmt = await dbConn.prepare(query);
    await stmt.query(...params);
    await stmt.close();
  } catch (error) {
    console.error("Database operation failed:", error);
  }
};
```

### Type-Safe Event Handling

```typescript
const handleEvent = (event: React.ChangeEvent<HTMLInputElement>) => {
  const value = event.target.value;
  // process value
};
```

## Dependencies and Extensions

### Core Dependencies

- React/ReactDOM for UI framework
- Three.js for 3D rendering
- @react-three/fiber and @react-three/drei for React integration
- @duckdb/duckdb-wasm for database functionality

### Development Dependencies

- TypeScript for type safety
- ESLint for code linting
- Prettier for code formatting
- Vite for build tooling

## Deployment and Build

- The project deploys to GitHub Pages automatically via GitHub Actions
- Build outputs are optimized for production
- WASM files and workers are handled correctly by Vite
- Large chunks are expected due to DuckDB WASM bundles

### CI/CD Workflow

- **Automated deployment**: Pushes to `main` branch trigger automatic deployment
- **Pull requests**: Also trigger build checks to ensure changes don't break the build
- **Node.js version**: CI uses Node.js 22 (configured in `.github/workflows/deploy.yml`)
- **Build process**: `npm ci` → `npm run build` → deploy to GitHub Pages

### Git Workflow

- Create feature branches for new development
- Ensure all linting and formatting checks pass before committing
- Run `npm run lint` and `npm run format:check` before pushing
- The build process will validate TypeScript compilation

## Tips for Contributors

1. **Working with 3D**: Understand Three.js coordinate systems and camera setup
2. **Database Integration**: Test both spatial and fallback modes
3. **File Handling**: Ensure proper file type validation and error handling
4. **Performance**: Monitor memory usage with large point clouds
5. **Browser Compatibility**: Test WASM functionality across browsers
6. **Type Safety**: Leverage TypeScript for better development experience
7. **Code Quality**: Always run formatting and linting before committing changes
8. **Testing**: Manually test the application in browser after changes

### Pre-commit Checklist

- [ ] `npm run lint` passes without errors
- [ ] `npm run format:check` passes without issues
- [ ] `npm run build` completes successfully
- [ ] Manual testing in browser works as expected
- [ ] No console errors in browser developer tools

When making changes, always consider the impact on:

- 3D rendering performance
- Database operation reliability
- File loading functionality
- User interaction responsiveness
- Browser compatibility

### Common Issues and Solutions

- **DuckDB initialization fails**: Check browser console for WASM-related errors
- **Spatial extension not loading**: The app includes fallback to JSON storage
- **Large file sizes**: DuckDB WASM bundles are inherently large (~70MB total)
- **Three.js rendering issues**: Check camera setup and coordinate transformations
- **TypeScript errors**: Ensure proper type annotations and null checks
