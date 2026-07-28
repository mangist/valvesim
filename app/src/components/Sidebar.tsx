import { ControlSlider } from './ControlSlider';
import { PalettePanel, type PlaceHandler } from './PalettePanel';

interface SidebarProps {
  onGridSizeChange?: (size: number) => void;
  onPlaceComponent?: PlaceHandler;
  onPaletteDragStateChange?: (dragging: boolean) => void;
}

/**
 * Left panel: component palette + inspector.
 *
 * Palette entries come from the component library (src/library);
 * canvas symbols for them (flat 2D labeled-pin SVG illustrations in the
 * style of the Hammond 372HX / 5U4G reference sheets) come next.
 */
export function Sidebar({
  onGridSizeChange,
  onPlaceComponent,
  onPaletteDragStateChange,
}: SidebarProps) {
  return (
    <aside className="vs-sidebar">
      <h2>Components</h2>
      <PalettePanel onPlace={onPlaceComponent} onDragStateChange={onPaletteDragStateChange} />

      <h2>Inspector</h2>
      <ControlSlider
        label="Grid size"
        min={5}
        max={50}
        step={5}
        defaultValue={20}
        unit="px"
        onChange={onGridSizeChange}
      />
    </aside>
  );
}
