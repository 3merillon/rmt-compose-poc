import type { Module } from '../../module.ts';
import type { ExpressionName } from '../../model-types.ts';
import type { Note } from '../../note.ts';
import type Fraction from 'fraction.js';
import type { CameraController } from './camera-controller.ts';
import type { RendererConfig, RendererConfigPatch } from './renderer-config.ts';
import type { Preview, RenderRecord, EvaluatedScene, SyncArgs, Marquee, SceneHit, DragOffset, DragOverlay, ByRelation, InputTheme, ColorCache, GlyphRun, Sprite, TextureEntry, Glyph, AtlasGlyph, Atlas, AtlasScratch, LinkWriter, LinkBasis, Overview, CachedRings } from './render-types.ts';
import { InstanceRanges } from './instance-ranges.ts';
import { defaultRendererConfig, normalizeRendererConfig, deepMerge } from './renderer-config.ts';
import { toNumber } from '../../utils/fraction-num.ts';
import { noteLabel, LINE_LABEL } from './note-label.ts';
import { parseCssColor } from '../../utils/css-color.ts';
import { amplitudeToGain } from '../../player/amplitude.ts';
import { isMeasureNote } from '../../note.ts';
import { envelopeShares } from '../../instruments/instrument-manager.ts';
import { getDisplayTransposition } from '../../player/display-transpose.ts';
import * as X from '../../value/exact.ts';
import { getInstrumentManager } from '../../store/app-state.ts';
/**
 * WebGL2 RendererAdapter
 * - Non-interactive overlay renderer for notes and playhead
 * - Uses Workspace viewport basis (a,b,c,d,e,f) to match world->screen transform
 *     x = seconds * 200 * xScaleFactor
 *     y = log2(baseFreq / freq) * 100 * yScaleFactor
 */
type FrequencyShadow = Fraction & { _irrational?: boolean; _floatValue?: number };

export class RendererAdapter {
  declare _config: RendererConfig;
  declare canvas: HTMLCanvasElement | null;
  declare gl: WebGL2RenderingContext | null;
  declare rectProgram: WebGLProgram | null;
  declare playheadProgram: WebGLProgram | null;
  declare measureDashProgram: WebGLProgram | null;
  declare rectBorderProgram: WebGLProgram | null;
  declare borderOnlyProgram: WebGLProgram | null;
  declare rectVAO: WebGLVertexArrayObject | null;
  declare rectUnitBuffer: WebGLBuffer | null;
  declare rectInstancePosSizeBuffer: WebGLBuffer | null;
  declare rectInstanceColorBuffer: WebGLBuffer | null;
  declare rectInstanceFlagsBuffer: WebGLBuffer | null;
  declare rectInstanceDragFlagsBuffer: WebGLBuffer | null;
  declare playheadVAO: WebGLVertexArrayObject | null;
  declare playheadPosSizeBuffer: WebGLBuffer | null;
  declare playheadColorBuffer: WebGLBuffer | null;
  declare instanceCount: number;
  declare devicePixelRatio: number;
  declare matrix: Float32Array<ArrayBuffer>;
  declare xScalePxPerWU: number;
  declare yScalePxPerWU: number;
  declare canvasOffset: { x: number; y: number; };
  declare _cachedCanvasRect: DOMRect | null;
  declare posSize: Float32Array<ArrayBuffer> | null;
  declare colors: Float32Array<ArrayBuffer> | null;
  declare _dragFlags: Float32Array<ArrayBuffer> | null;
  declare _corruptionType: Float32Array<ArrayBuffer> | null;
  declare _dragOffsetX: number;
  declare _dragOffsetW: number;
  declare _dragFlagsInited: boolean;
  declare _dragActive: boolean;
  declare _dragLastWasResize: boolean;
  declare currentXScaleFactor: number;
  declare currentYScaleFactor: number;
  declare _dragFlagsLastCount: number;
  declare _dragSetHash: number;
  declare _dragSetSize: number;
  declare _dragSetIndices: Int32Array<ArrayBuffer> | null;
  declare _dragAnchorIndex: number;
  declare _baselineNonMovingEndSec: number | null;
  declare _baselineMovingIdx: Int32Array<ArrayBuffer> | null;
  declare _dragDxSec: number;
  declare _dragDdSec: number;
  declare _lastDragXScale: number | null;
  declare _xScaleFactorAtLastSync: number;
  declare playheadTimeSec: number;
  declare playheadXWorld: number;
  declare _lastPlayheadLocalX: number | null;
  declare _lastPlayheadViewEpoch: number;
  declare _lastPlayheadScale: number;
  declare animHandle: number | null;
  declare needsRedraw: boolean;
  declare _resizeObserver: ResizeObserver | null;
  declare _baseFreqCache: number;
  declare _instanceNoteIds: Int32Array<ArrayBuffer> | null;
  declare _xScaleAtInit: number | null;
  declare trackingMode: boolean;
  declare _viewEpoch: number;
  declare _lastMeasureEpoch: number;
  declare _lastMeasureSolidEpoch: number;
  declare _lastTriEpoch: number;
  declare _triDataEpoch: number;
  declare _lastTriDataEpoch: number;
  declare _measurePreview: Record<number, number> | null;
  declare _triPreviewEpoch: number;
  declare _lastTriPreviewEpoch: number;
  declare _lastOctaveEpoch: number;
  declare _lastOctaveSelected: number | null | undefined;
  declare _lastOctaveRefFreq: number | null | undefined;
  declare _lastTabEpoch: number;
  declare _tabRegions: Float32Array<ArrayBuffer> | null;
  declare _tabInnerRegions: Float32Array<ArrayBuffer> | null;
  declare _lastArrowEpoch: number;
  declare _arrowUpRegions: Float32Array<ArrayBuffer> | null;
  declare _arrowDownRegions: Float32Array<ArrayBuffer> | null;
  declare _lastArrowUploadEpoch: number;
  declare _arrowRegionsDirty: boolean;
  declare _posEpoch: number;
  declare _sceneEpoch: number;
  declare _lastLinkPosEpoch: number;
  declare _lastLinkViewEpoch: number;
  declare _lastLinkAnchorId: number | null;
  declare _linkEndpointsDeps: Float32Array<ArrayBuffer> | null;
  declare _linkEndpointsRdeps: Float32Array<ArrayBuffer> | null;
  declare _linkDepsCount: number;
  declare _linkRdepsCount: number;
  declare _linkEndpointsByProperty: ByRelation<Float32Array<ArrayBuffer> | null | undefined>;
  declare _linkCountByProperty: { frequency: number; startTime: number; duration: number; };
  declare _linkFlagsByProperty: ByRelation<Float32Array<ArrayBuffer> | null | undefined>;
  declare _linkDepsEndpointsByProperty: ByRelation<Float32Array<ArrayBuffer> | null | undefined>;
  declare _linkDepsCountByProperty: { frequency: number; startTime: number; duration: number; };
  declare _linkDepsFlagsByProperty: ByRelation<Float32Array<ArrayBuffer> | null | undefined>;
  declare drawMeasureBars: boolean;
  declare drawMeasureSolids: boolean;
  declare drawOctaveGuides: boolean;
  declare drawNoteArrows: boolean;
  declare drawBaseFraction: boolean;
  declare _baseFracNum: string;
  declare _baseFracDen: string;
  declare drawNoteOverlays: boolean;
  declare enableSilenceEraseBands: boolean;
  declare _softTextureCapPx: number;
  declare _maxTextureSize: number | null;
  declare _maxOnscreenFontPx: number;
  declare _glyphBasePx: number;
  declare useGlyphCache: boolean;
  declare useGlyphAtlas: boolean;
  declare _atlasEnabledFlagRead: boolean;
  declare _atlas: Atlas | null;
  declare _uniforms: Record<string, Record<string, WebGLUniformLocation | null>>;
  declare _sceneDirty: boolean;
  declare _textDirty: boolean;
  declare _lastTextViewEpoch: number;
  declare _lastTextPosEpoch: number;
  declare _lastInstanceCount: number;
  declare _glyphRunsCache: GlyphRun[] | null;
  declare _dragEpoch: number;
  declare _lastTextDragEpoch: number;
  declare _lastLinkDragEpoch: number;
  declare _lastTabDragGeom: number;
  declare _lastArrowDragGeom: number;
  declare _lastTabPosEpoch: number;
  declare _lastArrowPosEpoch: number;
  declare _lastDividerEpoch: number;
  declare _lastDividerUploadEpoch: number;
  declare _dividerRegions: Float32Array<ArrayBuffer> | null;
  declare _anyDivider: boolean;
  declare _lastSelectedNoteId: number | null;
  declare _lastNoteFracNumStrs: (string | null)[] | null | undefined;
  declare _lastNoteFracDenStrs: (string | null)[] | null | undefined;
  declare _hoveredNoteId: number | null;
  declare _hoverSub: { id: number; region: string; } | null;
  declare _hoverBase: boolean;
  declare _hoveredMeasureId: number | null;
  declare _multiSelIds: Set<number> | null;
  declare _multiSelNoteIdx: number[] | null;
  declare _multiSelNoteMapRef: Map<number, number> | null;
  declare _marqueeRect: Marquee | null;
  declare _relDepsIdx: number[] | null;
  declare _relRdepsIdx: number[] | null;
  declare _relDepsMeasureIds: number[] | null;
  declare _relRdepsMeasureIds: number[] | null;
  declare _relDepsHasBase: boolean;
  declare _relRdepsHasBase: boolean;
  declare _relRdepsIdxByProperty: ByRelation<number[] | null>;
  declare _relDepsIdxByProperty: ByRelation<number[] | null>;
  declare _relRdepsHasBaseByProperty: { frequency: boolean; startTime: boolean; duration: boolean; };
  declare _relDepsHasBaseByProperty: { frequency: boolean; startTime: boolean; duration: boolean; };
  declare _themeColors: ColorCache;
  declare _colorEpoch: number;
  declare tailCount: number;
  declare _containerEl: HTMLElement | null;
  declare _onWinScroll: (() => void) | null | undefined;
  declare _onWinResize: (() => void) | null | undefined;
  declare _restoredDragIds: Set<number> | null;
  declare _syncRevision: number;
  declare _syncConfig: RendererConfig;
  declare _hasPreviewGeometry: boolean;
  declare _parsedColorCache: Map<string, number[] | null> | null;
  declare _idColorCache: Map<number, number[]> | null;
  declare _fracStrCache: Map<number, string[]> | null;
  declare _moduleRef: Module | null;
  declare _baseFreqExact: X.ExactValue | null;
  declare _maxNoteEndId: number | null;
  declare _maxNoteEndSec: number;
  declare _refLines: { id: number; freq: number; startSec: number | null }[];
  declare _tailItems: { x: number; y: number; w: number; h: number; color: number[]; level: number; under: number; }[];
  declare _naturalLastId: number | undefined;
  declare _instanceFlags: Float32Array<ArrayBuffer>;
  declare _envShape: Float32Array<ArrayBuffer>;
  declare _noteIdToIndex: Map<number, number>;
  declare _relDepsChainByProperty: ByRelation<number[]>;
  declare _relDepsChainIdxByProperty: ByRelation<number[]>;
  declare _linkTreeCache: { module: Module; anchor: number; pos: number; trees: ReturnType<Module['getChildrenTreeByAllProperties']> } | null;
  declare _noteFracNumStrs: (string | null)[];
  declare _noteFracDenStrs: (string | null)[];
  declare _noteLabelApprox: Uint8Array<ArrayBuffer>;
  declare _exactLabelCache: WeakMap<X.ExactValue, ReturnType<typeof noteLabel>>;
  declare _labelCacheBase: X.ExactValue | null;
  declare _rangeIndex: InstanceRanges | null | undefined;
  declare _simpleInstances: boolean;
  declare _lastSyncWasPartial: boolean;
  declare _zeros4Cache: Float32Array<ArrayBuffer>;
  declare _lastNoteLabelApprox: Uint8Array<ArrayBuffer>;
  declare _prospectiveParentId: number | null;
  declare _multiSelMeasureIds: number[] | null;
  declare tailProgram: WebGLProgram | null | undefined;
  declare selectionRingProgram: WebGLProgram | null | undefined;
  declare selectionFillProgram: WebGLProgram | null | undefined;
  declare tabMaskProgram: WebGLProgram | null | undefined;
  declare silenceDashRingProgram: WebGLProgram | null | undefined;
  declare rectInstanceTabRegionBuffer: WebGLBuffer;
  declare rectInstanceTabInnerBuffer: WebGLBuffer;
  declare rectInstanceArrowRegionBuffer: WebGLBuffer;
  declare rectInstanceArrowDownRegionBuffer: WebGLBuffer;
  declare rectInstanceDividerRegionBuffer: WebGLBuffer;
  declare rectInstanceCorruptionBuffer: WebGLBuffer;
  declare rectInstanceEnvBuffer: WebGLBuffer;
  declare tailVAO: WebGLVertexArrayObject;
  declare tailPosSizeBuffer: WebGLBuffer;
  declare tailColorBuffer: WebGLBuffer;
  declare tailLevelBuffer: WebGLBuffer;
  declare _singlePosSizeBuffer: WebGLBuffer;
  declare _ringBuffers: Map<string, CachedRings>;
  declare _depRingBatch: Float32Array<ArrayBuffer>;
  declare _detailRanges: number[];
  declare _nextVisibleRanges: number[];
  declare _visibleRanges: number[];
  declare _lastDetailRanges: number[];
  declare _detailBlocks: number[];
  declare _overviewDetails: Overview;
  declare _instanceBaseUniforms: WeakMap<WebGLProgram, WebGLUniformLocation | null>;
  declare _dragPreviewIdsRef: number[] | Set<number> | null | undefined;
  declare _dragMovingIds: Set<number> | null;
  declare _pendingDragIdxArr: number[] | null | undefined;
  declare _dragOriginalPos: Map<number, {x: number; w: number}> | null;
  declare _endTimePreviewSec: number | null | undefined;
  declare measureVAO: WebGLVertexArrayObject;
  declare _measureUnitBuffer: WebGLBuffer;
  declare measurePosSizeBuffer: WebGLBuffer;
  declare measureColorBuffer: WebGLBuffer;
  declare measureCount: number;
  declare measurePosSize: Float32Array<ArrayBuffer> | null | undefined;
  declare measureColors: Float32Array<ArrayBuffer> | null | undefined;
  declare measureSolidVAO: WebGLVertexArrayObject;
  declare _measureSolidUnitBuffer: WebGLBuffer;
  declare measureSolidPosSizeBuffer: WebGLBuffer;
  declare measureSolidColorBuffer: WebGLBuffer;
  declare measureSolidCount: number;
  declare measureSolidPosSize: Float32Array<ArrayBuffer> | null | undefined;
  declare measureSolidColors: Float32Array<ArrayBuffer> | null | undefined;
  declare measureTriProgram: WebGLProgram | null | undefined;
  declare measureTriOutlineProgram: WebGLProgram | null | undefined;
  declare baseCircleProgram: WebGLProgram | null | undefined;
  declare baseCircleVAO: WebGLVertexArrayObject;
  declare _baseCircleUnitBuffer: WebGLBuffer;
  declare baseCirclePosSizeBuffer: WebGLBuffer;
  declare baseCirclePosSize: Float32Array<ArrayBuffer> | null;
  declare measureTriVAO: WebGLVertexArrayObject;
  declare _measureTriUnitBuffer: WebGLBuffer;
  declare measureTriPosSizeBuffer: WebGLBuffer;
  declare measureTriDragFlagBuffer: WebGLBuffer;
  declare measureTriPosSizeOutlineBuffer: WebGLBuffer;
  declare measureTriCount: number;
  declare measureTriPosSize: Float32Array<ArrayBuffer> | null | undefined;
  declare measureTriPosSizeOutline: Float32Array<ArrayBuffer> | null | undefined;
  declare _measureTriTimes: number[] | null | undefined;
  declare _measureTriIds: number[] | null;
  declare octaveLineProgram: WebGLProgram | null | undefined;
  declare silenceVLineProgram: WebGLProgram | null | undefined;
  declare octaveLineVAO: WebGLVertexArrayObject;
  declare _octaveUnitBuffer: WebGLBuffer;
  declare octaveLinePosSizeBuffer: WebGLBuffer;
  declare measureDashDragFlagBuffer: WebGLBuffer;
  declare textProgram: WebGLProgram | null | undefined;
  declare textVAO: WebGLVertexArrayObject;
  declare _textUnitBuffer: WebGLBuffer;
  declare textPosSizeBuffer: WebGLBuffer;
  declare solidCssProgram: WebGLProgram | null | undefined;
  declare textCircMaskProgram: WebGLProgram | null | undefined;
  declare solidCssCircMaskProgram: WebGLProgram | null | undefined;
  declare _octaveLinesPosSize: Float32Array<ArrayBuffer> | null | undefined;
  declare _octaveLabelCache: Map<string, TextureEntry>;
  declare _octaveIndices: number[];
  declare _syncedMeasures: Note[];
  declare _moduleEndTime: number;
  declare _measureTriIdToIndex: Map<number, number>;
  declare _lastMeasureMeta: { id: number; baseStartSec: number; lengthSec: number } | null;
  declare _lastDashFlagsKey: string | null;
  declare _baseCircleCss: { cx: number; cy: number; r: number; };
  declare _measureTriCss: Float32Array<ArrayBuffer> | null | undefined;
  declare _lastTriFlagsKey: string | null;
  declare _measureRingCache: {rect: Marquee | null; committed: number[] | null; css: Float32Array<ArrayBuffer> | null | undefined; map: Map<number,number> | null; view: number; preview: number; boxes: Float32Array<ArrayBuffer>};
  declare _deferredGlyphRuns: GlyphRun[];
  declare _atlasGlyphCache: { runs: GlyphRun[]; count: number } | null;
  declare _textRebuildThisFrame: boolean;
  declare _deferredTextSprites: Sprite[];
  declare _hoverRegionScratchBuffer: WebGLBuffer;
  declare _silenceEraseRegions: Float32Array<ArrayBuffer> | null;
  declare _anySilenceErase: boolean;
  declare _glyphCache: Map<string, Glyph>;
  declare _wordCache: Map<string, TextureEntry>;
  declare _glyphCacheInitialized: boolean;
  declare _runMetricsCache: Map<string, {ascent: number; descent: number; width: number; height: number}>;
  declare _metricsCanvas: HTMLCanvasElement;
  declare _metricsCtx: CanvasRenderingContext2D | null | undefined;
  declare atlasTextProgram: WebGLProgram | null | undefined;
  declare atlasVAO: WebGLVertexArrayObject;
  declare _atlasUnitBuffer: WebGLBuffer;
  declare atlasPosSizeBuffer: WebGLBuffer;
  declare atlasUVRectBuffer: WebGLBuffer;
  declare atlasColorBuffer: WebGLBuffer;
  declare atlasZBuffer: WebGLBuffer;
  declare atlasClipRectBuffer: WebGLBuffer;
  declare atlasRRCenterSizeBuffer: WebGLBuffer;
  declare atlasRRRadiusBuffer: WebGLBuffer;
  declare atlasDragFlagBuffer: WebGLBuffer;
  declare _atlasScratch: AtlasScratch;
  declare _atlasDragFlagsDirty: boolean;
  declare _selectedNoteIdForGuides: number | null | undefined;
  declare _refFreqForGuides: number;
  declare _selectedHasFrequencyForGuides: boolean;
  declare octaveLineInstProgram: WebGLProgram | null | undefined;
  declare octaveLineInstVAO: WebGLVertexArrayObject;
  declare octaveLineInstPosSizeBuffer: WebGLBuffer;
  declare octaveLineInstHoleBuffer: WebGLBuffer;
  declare octaveLineInstColorBuffer: WebGLBuffer;
  declare _octInstPosSize: Float32Array<ArrayBuffer>;
  declare _octInstHole: Float32Array<ArrayBuffer>;
  declare _octInstColor: Float32Array<ArrayBuffer>;
  declare _linkPool: Map<string, LinkWriter>;
  declare drawLinkLines: boolean;
  declare drawDragOverlays: boolean;
  declare drawDragGhosts: boolean;
  declare linkLineProgram: WebGLProgram | null | undefined;
  declare linkLineVAO: WebGLVertexArrayObject;
  declare _linkLineUnitBuffer: WebGLBuffer;
  declare linkLineEndpointsBufferDeps: WebGLBuffer;
  declare linkLineEndpointsBufferRdeps: WebGLBuffer;
  declare linkLineFlagsBufferDeps: WebGLBuffer;
  declare linkLineFlagsBufferRdeps: WebGLBuffer;
  declare _linkBuffersByProperty: Record<string, {endpoints: WebGLBuffer; flags: WebGLBuffer}>;
  declare _linkDepsBuffersByProperty: Record<string, {endpoints: WebGLBuffer; flags: WebGLBuffer}>;
  declare _dragOverlay: DragOverlay | null;
  declare _dragOverlayIdsRef: number[] | null;
  declare _lastLinkTriDataEpoch: number;
  declare _lastLinkProspectiveParentId: number | null;
  declare _linkBasis: LinkBasis;
  declare marqueeProgram: WebGLProgram | null | undefined;
  declare marqueeVAO: WebGLVertexArrayObject;
  declare _marqueeUnitBuffer: WebGLBuffer;
  declare _refLineCss: {id: number; y: number; x0: number}[];
  declare _pickRanges: number[];
  declare _initMeasurePass: () => void;
  declare _collectMeasureNotes: (module: Module) => Note[];
  declare _computeModuleEndTime: (module: Module, measureNotes?: Note[] | null) => number;
  declare _syncMeasureBars: (module: Module, knownMeasures?: Note[] | null) => void;
  declare _renderMeasureBars: () => void;
  declare _renderBaseFractionIfMissing: () => void;
  declare _renderNoteOverlays: () => void;
  declare _approximateFraction: (x: number, maxDen: number, maxDigits: number) => { n: number; d: number };
  declare _getMaxTextureCapPx: () => number;
  declare _calcTextBackingScale: (wPx: number, hPx: number) => number;
  declare _clampFontPx: (px: number) => number;
  declare _createTextTexture: (label: string) => TextureEntry | null;
  declare _createNarrowTextTexture: (label: string, fontPx?: number, pad?: number) => TextureEntry | null;
  declare _createStyledTextTexture: (label: string, fontPx?: number, pad?: number, color?: string, shadowColor?: string, shadowBlur?: number) => TextureEntry | null;
  declare _createTightDigitTexture: (label: string, fontPx?: number, pad?: number, color?: string) => TextureEntry | null;
  declare _initGlyphCache: () => void;
  declare _getGlyph: (ch: string) => Glyph | null | undefined;
  declare _getGlyphSize: (ch: string, targetFontPx: number) => {w: number; h: number; ascent: number; inkTop: number; inkBottom: number} | null;
  declare _refreshGlyphCaches: () => void;
  declare _measureGlyphRunWidth: (text: string, targetFontPx: number) => number;
  declare _getRunAscent: (text: string, targetFontPx: number) => number;
  declare _getRunHeight: (text: string, targetFontPx: number) => number;
  declare _measureRunMetricsCanvas: (text: string, fontPx: number) => {ascent: number; descent: number; width: number; height: number};
  declare _getWordSilence: () => TextureEntry | null;
  declare _initGlyphAtlas: () => void;
  declare _ensureAtlasGlyph: (ch: string) => AtlasGlyph | null | undefined;
  declare _flushGlyphRunsAtlas: () => void;
  declare _buildAtlasGlyphInstances: (runs: GlyphRun[], vpW: number, vpH: number) => number;
  declare _uploadAtlasDragFlags: (runs: GlyphRun[], count: number) => void;
  declare _drawAtlasGlyphInstances: (count: number, vpW: number, vpH: number, reused: boolean) => void;
  declare _drawGlyphRun: (text: string, x: number, y: number, fontPx: number, scaleX?: number) => void;
  declare _ensureOctaveGuides: () => void;
  declare _renderOctaveGuides: () => void;
  declare _pointInTriangle: (px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => boolean;
  declare pickBaseCircleAt: (clientX: number, clientY: number) => SceneHit[];
  declare pickTrianglesAt: (clientX: number, clientY: number, firstOnly?: boolean) => SceneHit[];
  declare pickTopAt: (clientX: number, clientY: number, expandCssPx?: number, noteHit?: SceneHit | null) => SceneHit | null;
  declare pickAllAt: (clientX: number, clientY: number, expandCssPx?: number) => SceneHit[];
  declare _renderOctaveGuidesInstanced: () => void;
  declare _linkWriter: (key: string) => LinkWriter;
  declare _initLinkLinesPass: () => void;
  declare setDragOverlay: (state: DragOverlay | null) => void;
  declare clearDragOverlay: () => void;
  declare _renderDependencyLinesAndDragOverlay: () => void;
  declare _initMarqueePass: () => void;
  declare _renderMarquee: () => void;
  declare _renderReferenceLines: () => void;
  declare pickReferenceLinesAt: (clientX: number, clientY: number, firstOnly?: boolean) => SceneHit[];

  constructor(config: RendererConfigPatch | null = null) {
    // Normalize configuration; defaults preserve existing behavior
    this._config = normalizeRendererConfig(config);
    this.canvas = null;
    this.gl = null;

    this.rectProgram = null;
    this.playheadProgram = null;
    this.measureDashProgram = null;
    this.rectBorderProgram = null;
    this.borderOnlyProgram = null;

    this.rectVAO = null;
    this.rectUnitBuffer = null;
    this.rectInstancePosSizeBuffer = null;
    this.rectInstanceColorBuffer = null;
    this.rectInstanceFlagsBuffer = null;
    this.rectInstanceDragFlagsBuffer = null;

    this.playheadVAO = null;
    this.playheadPosSizeBuffer = null;
    this.playheadColorBuffer = null;

    this.instanceCount = 0;

    this.devicePixelRatio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;

    // World -> Screen affine matrix (column-major mat3)
    // Defaults to identity
    this.matrix = new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);

    // Cached scale along X (pixels per world unit), derived from Workspace basis
    this.xScalePxPerWU = 1;
    // Cached scale along Y (pixels per world unit), derived from Workspace basis
    this.yScalePxPerWU = 1;

    // Canvas offset for proper coordinate transformation
    this.canvasOffset = { x: 0, y: 0 };
    // Cached canvas bounding rect (updated on resize/scroll, avoids per-frame layout query)
    this._cachedCanvasRect = null;

    // Data buffers (CPU side)
    this.posSize = null; // Float32Array of [x,y,w,h] per instance
    this.colors  = null; // Float32Array of [r,g,b,a] per instance
    this._dragFlags = null; // Float32Array of [0|1] per instance (1 = apply drag offset)
    this._corruptionType = null; // Float32Array of [0|1|2] per instance (corruption hatching)
    
    // Drag offset state (world units)
    this._dragOffsetX = 0.0;
    this._dragOffsetW = 0.0; // width delta for resize
    // Flags buffer is initialized once per drag; skip re-uploads on every pointer move
    this._dragFlagsInited = false;
     // Drag activity flag to allow render-time gating without thrashing other epochs
        this._dragActive = false;
        // Track if last preview step was a resize (non-zero width delta)
        this._dragLastWasResize = false;

    // Current scales for computing world coords
    this.currentXScaleFactor = 1.0;
    this.currentYScaleFactor = 1.0;

    // Drag flags upload state
    this._dragFlagsInited = false;
    this._dragFlagsLastCount = 0;
    // Cached signature of current drag set to avoid per-frame flag buffer re-uploads
    this._dragSetHash = 0;
    this._dragSetSize = 0;
    this._dragSetIndices = null; // Int32Array of instance indices currently flagged
    this._dragAnchorIndex = -1;  // instance index of anchor note (for ring/posSize CPU updates)

    // End-bar preview baselines/deltas (populated at drag start and reused per-frame)
    this._baselineNonMovingEndSec = null;   // max end over non-moving notes at drag start
    this._baselineMovingIdx = null;         // Int32Array of moving indices to scan quickly
    this._dragDxSec = 0.0;                  // seconds delta for position shift
    this._dragDdSec = 0.0;                  // seconds delta for width (rarely used; anchor baked)
    this._lastDragXScale = null;            // xScale snapshot when baselines computed

    // Track last-synced X scale to keep playhead in lockstep with scene during scale changes
    this._xScaleFactorAtLastSync = 1.0;

    // Playhead time and world coords (x), computed from time
    this.playheadTimeSec = 0;
    this.playheadXWorld = 0;
    // Single-frame gating to avoid 1-frame playhead pop during X-scale changes
    this._lastPlayheadLocalX = null;
    this._lastPlayheadViewEpoch = -1;
    this._lastPlayheadScale = 1.0;

    this.animHandle = null;
    this.needsRedraw = true;

    // Resize handling
    this._resizeObserver = null;

    // Frequency cache (for base note)
    this._baseFreqCache = 440;

    // CPU picking: instance note ids (draw order)
    this._instanceNoteIds = null;
    this._xScaleAtInit = null;
    // Tracking mode: keep playhead rendered at viewport center regardless of matrix when true
    this.trackingMode = false;

    // View/zoom epoch tracking for dirty gating of per-frame uploads
    this._viewEpoch = 0;
    this._lastMeasureEpoch = -1;
    this._lastMeasureSolidEpoch = -1;
    this._lastTriEpoch = -1;
    // Incremented when measure triangle data changes (add/remove/reorder)
    this._triDataEpoch = 0;
    this._lastTriDataEpoch = -1;

    // Measure preview overrides (id -> startSec) for triangles/bars/end bar live preview
    this._measurePreview = null;
    // Preview epoch to rebuild triangles/dashed bars/end bar on change
    this._triPreviewEpoch = 0;
    this._lastTriPreviewEpoch = -1;
    // Octave guides epoch and context gating for instanced path
    this._lastOctaveEpoch = -1;
    this._lastOctaveSelected = null;
    this._lastOctaveRefFreq = null;
    // Tab/pull-handle epoch gating and cached regions
    this._lastTabEpoch = -1;
    this._tabRegions = null;        // Float32Array(N*4) cached per-instance [xL,xR,yT,yB] in note-local CSS px
    this._tabInnerRegions = null;   // Float32Array(N*4) cached per-instance inner handle rect
    // Batched octave-arrow backgrounds gating and cached regions
    this._lastArrowEpoch = -1;
    this._arrowUpRegions = null;    // Float32Array(N*4) [xL,xR,yT,yB] per instance (upper half)
    this._arrowDownRegions = null;  // Float32Array(N*4) per instance (lower half)
    // Track last GPU upload epoch for arrow backgrounds to avoid redundant bufferData on every frame
    this._lastArrowUploadEpoch = -1;
    this._arrowRegionsDirty = true;

    // Position epoch to gate dependent overlay uploads (link lines, guides)
    this._posEpoch = 0;
    // Scene epoch: bumped after sync completes; used for post-sync overlay gating
    // Separate from _posEpoch to avoid double-invalidation of dependency caches
    this._sceneEpoch = 0;
    // Link-line caching: rebuild only when anchor/view/pos epoch changes
    this._lastLinkPosEpoch = -1;
    this._lastLinkViewEpoch = -1;
    this._lastLinkAnchorId = null;
    // Cached endpoints and draw counts
    this._linkEndpointsDeps = null;
    this._linkEndpointsRdeps = null;
    this._linkDepsCount = 0;
    this._linkRdepsCount = 0;
    // Property-colored link lines (rdeps categorized by property)
    this._linkEndpointsByProperty = { frequency: null, startTime: null, duration: null };
    this._linkCountByProperty = { frequency: 0, startTime: 0, duration: 0 };
    this._linkFlagsByProperty = { frequency: null, startTime: null, duration: null };
    // Property-colored link lines (deps categorized by property)
    this._linkDepsEndpointsByProperty = { frequency: null, startTime: null, duration: null };
    this._linkDepsCountByProperty = { frequency: 0, startTime: 0, duration: 0 };
    this._linkDepsFlagsByProperty = { frequency: null, startTime: null, duration: null };

    // Rendering feature toggles (suppress legacy-equivalent visuals in GL)
    this.drawMeasureBars = true;    // dashed vertical measure bars
    this.drawMeasureSolids = true;  // start/end vertical offset bars
    this.drawOctaveGuides = true;   // horizontal dotted lines + labels

    // Per-note octave/interval arrows (▲/▼). User-toggleable via Settings →
    // Arrows. Default true = current behavior. Gates the glyph draw, the
    // batched background pass, and the octaveUp/octaveDown hit-test regions.
    this.drawNoteArrows = true;

    // Base note fraction (numerator/denominator) rendering
    this.drawBaseFraction = true;
    this._baseFracNum = '1';
    this._baseFracDen = '1';

        // Note overlays: id label, fraction, arrows, resize handle
        this.drawNoteOverlays = true;
        // Legacy DOM parity workaround for mixed mode; never used in full GL workspace
        // When false, disables the "silence erase bands" pass that can cause black bars.
        this.enableSilenceEraseBands = false;

    // Text rendering safety/quality controls
    // Soft cap for text texture backing store (device px); hard cap queried from GPU
    this._softTextureCapPx = (this._config?.text?.softTextureCapPx ?? 1024);
    this._maxTextureSize = null;          // set in init() after GL is available
    // Clamp max on-screen font size in CSS px; beyond this we avoid up-resing text
    this._maxOnscreenFontPx = (this._config?.text?.maxOnscreenFontPx ?? 96);
    // Glyph base pixel size for cache/atlas
    this._glyphBasePx = (this._config?.text?.glyphBasePx ?? 64);
    // Glyph cache path for performance (pre-rasterized digits/brackets/arrows/"silence")
    this.useGlyphCache = true;
    // Glyph atlas feature flag (atlas=1 in URL or localStorage 'rmt:atlas' === '1')
    this.useGlyphAtlas = false;
    this._atlasEnabledFlagRead = false;
    // Atlas state (initialized in _initGlyphAtlas)
    this._atlas = null; // { tex, canvas, ctx, w, h, nextX, nextY, rowH, pad, map: Map<char, entry> }
 
    // Cached uniform locations per program to avoid per-frame lookups
    this._uniforms = {};
    // Dirty gating flags and caches (event-driven uploads; avoid per-frame rebuilds)
    // - _sceneDirty: geometry/instance data changed (notes added/removed/sorted/positions/colors)
    // - _textDirty: glyph-run layout changed (IDs, fractions, arrows, "silence") or selection/zoom impacts layout
    // - _lastTextViewEpoch: last view epoch when glyph positions (CSS px) were computed
    // - _lastInstanceCount: last note instance count used to build buffers
    // - _glyphRunsCache: cached glyph-run list to reuse when only playhead moves
    this._sceneDirty = false;
    this._textDirty = false;
    this._lastTextViewEpoch = -1;
    // Text runs hold absolute CSS positions, so they go stale when notes MOVE, not just when
    // their content changes. sync() bumps _posEpoch on every call, so keying the run cache on
    // it is what makes a drop/move rebuild the labels instead of leaving them at the old spot.
    this._lastTextPosEpoch = -1;
    this._lastInstanceCount = 0;
    this._glyphRunsCache = null;

    // Drag preview epoch. A drag deliberately does NOT bump _posEpoch (rebuilding link-line
    // endpoints for thousands of dependents every pointermove is too expensive), and moving
    // notes are instead shifted on the GPU. But the ANCHOR note is different: its posSize is
    // rewritten on the CPU each pointermove, so anything derived from absolute positions —
    // the glyph runs and the dependency-line endpoints — really does go stale while dragging.
    // This epoch is that invalidation signal. It used to be supplied by accident: _viewEpoch
    // was bumped on every frame, so everything rebuilt regardless and the "do not bump
    // _posEpoch" optimisation never actually took effect.
    this._dragEpoch = 0;
    this._lastTextDragEpoch = -1;
    this._lastLinkDragEpoch = -1;
    // Note-local overlay regions (pull tab, arrow columns) are derived from each note's
    // posSize width/height. Resizing bakes the anchor's NEW width straight into posSize
    // without bumping _posEpoch (the resize shifts dependents via _dragOffsetX instead), so
    // _posEpoch alone does not catch it and the tab/arrows keep the note's old size while the
    // body stretches. Keying them on the drag epoch — which ticks on every pointermove of a
    // drag — recomputes them from the live posSize, which is what the old per-frame
    // _viewEpoch churn was silently doing.
    this._lastTabDragGeom = -1;
    this._lastArrowDragGeom = -1;
    // The regions are a pure function of each note's posSize (width/height) and the zoom,
    // so a resize — which rewrites posSize.w — must rebuild them. Keying them on _posEpoch
    // is that dependency; without it the pull tab and arrow columns keep the note's OLD
    // width while the body stretches. (Previously masked by the per-frame _viewEpoch churn.)
    this._lastTabPosEpoch = -1;
    this._lastArrowPosEpoch = -1;

    // Divider/draw caching epochs
    this._lastDividerEpoch = -1;
    this._lastDividerUploadEpoch = -1;
    // Cached divider regions between frames
    this._dividerRegions = null;
    this._anyDivider = false;
    // Track selection and last text content snapshot to gate text rebuilds
    this._lastSelectedNoteId = null;
    this._lastNoteFracNumStrs = null;
    this._lastNoteFracDenStrs = null;

    // Hover state (for hover ring highlight)
    this._hoveredNoteId = null;
    // Hovered subregion target for background emphasis: { id, region } or null
    this._hoverSub = null;

    // Hover BaseNote and Measure triangle
    this._hoverBase = false;           // true when BaseNote hovered
    this._hoveredMeasureId = null;     // measure note id when hovered

    // Multi-selection (marquee / shift-click). _multiSelIds is the source of truth; the
    // index array is a derived cache keyed on the id->index Map it was built from.
    // NOTES ONLY — measure bars are deliberately not selectable: a measure's startTime is
    // its link in the measure chain, so a group move can neither re-anchor it (that would
    // reflow the grid under the whole score) nor leave it behind (the group would tear on
    // drop). See pickRect().
    this._multiSelIds = null;          // Set<number> of note ids, or null when empty
    this._multiSelNoteIdx = null;      // instance indices into posSize
    this._multiSelNoteMapRef = null;   // identity of _noteIdToIndex the note indices came from

    // Rubber-band marquee rectangle in client CSS px, or null when not dragging one
    this._marqueeRect = null;

    // Related highlight indices (notes) and measure ids (computed each sync)
    // Notes:
    //   _relDepsIdx: indices of notes this selected note depends on (direct)
    //   _relRdepsIdx: indices of notes that depend on the selected note (transitive)
    this._relDepsIdx = null;
    this._relRdepsIdx = null;
    // Measures:
    this._relDepsMeasureIds = null;    // array of measure note ids (dependencies)
    this._relRdepsMeasureIds = null;   // array of measure note ids (dependents)
    // Base highlight flags for dependency sets (when selected entity is measure/note)
    this._relDepsHasBase = false;
    this._relRdepsHasBase = false;

    // Property-colored dependency visualization
    // Dependents (rdeps) categorized by which property of the selected note they reference:
    // - frequency: notes that would move if selected note's frequency changes (orange)
    // - startTime: notes that would move if selected note's startTime changes (teal)
    // - duration: notes that would move if selected note's duration changes (purple)
    this._relRdepsIdxByProperty = { frequency: null, startTime: null, duration: null };
    // Dependencies (deps) categorized by which expression of the selected note references them:
    this._relDepsIdxByProperty = { frequency: null, startTime: null, duration: null };
    // Base flags per property (for baseNote ring coloring)
    this._relRdepsHasBaseByProperty = { frequency: false, startTime: false, duration: false };
    this._relDepsHasBaseByProperty = { frequency: false, startTime: false, duration: false };


  }

  // Update configuration at runtime. Merges partial into current and normalizes; triggers redraw.
  setConfig(partial: RendererConfigPatch) {
    try {
      this._config = normalizeRendererConfig(deepMerge(this._config, partial || {}));
      this.needsRedraw = true;
    } catch {}
  }

  /**
   * Theme the GL accent/structural colors at runtime (Phase 3 GL theming).
   * Accepts hex strings; stores both hex and premultiplied-friendly RGBA
   * arrays for the draw paths. Canvas-textured labels (note ids, octave guide
   * labels, measure ids) are cached by string key, so we invalidate that
   * cache and bump the color epoch so they regenerate in the new color.
   * @param {{accent?:string,noteBorder?:string,measureBar?:string,selectionRing?:string,hoverRing?:string,depFrequency?:string,depStartTime?:string,depDuration?:string,textPrimary?:string}} colors
   */
  setThemeColors(colors: InputTheme) {
    try {
      if (!colors || typeof colors !== 'object') return;
      const hexToRgba = (hex: unknown, fallback: number[]) => {
        if (typeof hex !== 'string') return fallback;
        let h = hex.trim().replace(/^#/, '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        if (h.length !== 6) return fallback;
        const n = parseInt(h, 16);
        if (Number.isNaN(n)) return fallback;
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1.0];
      };
      const tc = this._themeColors || (this._themeColors = {});
      if (colors.accent) { tc.accentHex = colors.accent; tc.accent = hexToRgba(colors.accent, [1.0, 0.66, 0.0, 1.0]); }
      if (colors.noteBorder) { tc.noteBorderHex = colors.noteBorder; tc.noteBorder = hexToRgba(colors.noteBorder, [0.388, 0.388, 0.388, 1.0]); }
      if (colors.measureBar) { tc.measureBarHex = colors.measureBar; tc.measureBar = hexToRgba(colors.measureBar, [1, 1, 1, 1]); }
      if (colors.selectionRing) { tc.selectionRing = hexToRgba(colors.selectionRing, [1.0, 0.66, 0.0, 1.0]); }
      if (colors.hoverRing) { tc.hoverRing = hexToRgba(colors.hoverRing, [1, 1, 1, 1]); }
      if (colors.depFrequency) tc.depFrequency = hexToRgba(colors.depFrequency, [1.0, 0.5, 0.0, 1.0]);
      if (colors.depStartTime) tc.depStartTime = hexToRgba(colors.depStartTime, [0.0, 1.0, 1.0, 1.0]);
      if (colors.depDuration) tc.depDuration = hexToRgba(colors.depDuration, [0.615, 0.0, 1.0, 1.0]);
      if (colors.textPrimary) { tc.noteTextHex = colors.textPrimary; tc.noteText = hexToRgba(colors.textPrimary, [1, 1, 1, 1]); }

      // Canvas-textured labels are cached by string key with no color in it —
      // clear so they redraw in the new accent.
      try { if (this._octaveLabelCache && typeof this._octaveLabelCache.clear === 'function') this._octaveLabelCache.clear(); } catch {}
      // Glyph atlas entries for id/fraction labels may also be color-baked.
      this._colorEpoch = (this._colorEpoch || 0) + 1;
      this._viewEpoch = (this._viewEpoch || 0) + 1; // force overlay/label rebuild
      this.needsRedraw = true;
    } catch {}
  }

  // Accent color accessors with safe fallbacks (current #ffa800 values).
  _accentRgba() { return (this._themeColors && this._themeColors.accent) || [1.0, 0.66, 0.0, 1.0]; }
  _accentHex() { return (this._themeColors && this._themeColors.accentHex) || '#ffa800'; }
  _noteBorderRgba() { return (this._themeColors && this._themeColors.noteBorder) || [0.388, 0.388, 0.388, 1.0]; }
  _measureBarRgb() { return (this._themeColors && this._themeColors.measureBar) || [1.0, 1.0, 1.0, 1.0]; }
  // Ring / on-note text theme accessors. Fallbacks are the pre-theme hardcoded
  // literals (white rings/text, orange/teal/purple dependency rings) so an
  // unthemed boot renders exactly as before.
  _selectionRingRgba() { return (this._themeColors && this._themeColors.selectionRing) || [1.0, 1.0, 1.0, 1.0]; }
  _hoverRingRgba() { return (this._themeColors && this._themeColors.hoverRing) || [1.0, 1.0, 1.0, 1.0]; }
  _depFrequencyRgba() { return (this._themeColors && this._themeColors.depFrequency) || [1.0, 0.5, 0.0, 1.0]; }
  _depStartTimeRgba() { return (this._themeColors && this._themeColors.depStartTime) || [0.0, 1.0, 1.0, 1.0]; }
  _depDurationRgba() { return (this._themeColors && this._themeColors.depDuration) || [0.615, 0.0, 1.0, 1.0]; }
  _noteTextRgba() { return (this._themeColors && this._themeColors.noteText) || [1.0, 1.0, 1.0, 1.0]; }
  _noteTextHex() { return (this._themeColors && this._themeColors.noteTextHex) || '#ffffff'; }

  // Config helpers (seconds/world X, freq/world Y)
  _cfgSX() { try { return this._config?.scales?.secondsToWorldX ?? 200; } catch { return 200; } }
  _cfgSY() { try { return this._config?.scales?.freqToWorldY ?? 100; } catch { return 100; } }

  // World-Y of a frequency's *line* — the axis that octave guides, the BaseNote
  // circle and dependency-line endpoints are all drawn on. A note's vertical
  // centre is pinned to this, so note height can change without the note
  // drifting off its own frequency.
  _cfgCenterAnchor() { try { return this._config?.note?.centerAnchorWU ?? 10; } catch { return 10; } }
  _cfgNoteH() { try { return this._config?.note?.heightWU ?? 22; } catch { return 22; } }
  // Note height as a picture of loudness: the configured height times the square
  // root of the gain playback uses (amplitude clamped to 0..4), kept within
  // 0.6x..2x so that the quietest note still holds its labels. Amplitude 1 gives
  // exactly 1: a module that sets no amplitude draws as it always has.
  _amplitudeHeightScale(amplitude: Fraction | number | null) {
    const gain = amplitudeToGain(amplitude);
    if (gain === 1) return 1;
    const s = Math.sqrt(gain);
    return s < 0.6 ? 0.6 : (s > 2 ? 2 : s);
  }
  _noteCenterY(freq: number) { return this._frequencyToY(freq) + this._cfgCenterAnchor(); }
  // The envelope of one note as shares of its duration, from the same function the
  // audio engine uses (envelopeShares in instrument-manager.js): the note's own
  // attack and release, the instrument's envelope (in seconds, some following the
  // pitch) for what it leaves unset, the anti-click floors. Returns [attack, decay,
  // level, release, tail, levelAtEnd] or null. The release sounds AFTER the note's
  // end, so inside the note there is none to draw (release share 0): the band holds
  // the level the body reaches until the end. `tail` is that release as a share of
  // the duration (drawn past the end when tails are on), starting from `levelAtEnd`.
  _envelopeSharesFor(module: Module, note: Note, durSec: number, attack: Fraction | null | undefined, release: Fraction | null | undefined, freq: number | null, memo: Parameters<Module['findInstrument']>[1] = null) {
    try {
      const shape = { attack: attack ? toNumber(attack, null) : null, release: release ? toNumber(release, null) : null };
      let env = {};
      const im = getInstrumentManager();
      if (im && typeof im.getInstrument === 'function') {
        const inst = im.getInstrument(String(module.findInstrument(note, memo) || '').toLowerCase());
        if (inst && typeof inst.getEnvelopeSettings === 'function') env = inst.getEnvelopeSettings(durSec, Number(freq)) || {};
      }
      const s = envelopeShares(env, durSec, shape);
      return [s.attack, s.decay, s.sustain, 0, s.release, s.sustain];
    } catch { return null; }
  }

  // The tails sync() collected, into their instance buffers. Nothing to do (and
  // nothing uploaded) when tails are off: tailCount 0 skips the pass entirely.
  _syncTails() {
    const items = this._tailItems || [];
    const M = items.length;
    this.tailCount = M;
    if (!M || !this.gl || !this.tailPosSizeBuffer) return;
    const pos = new Float32Array(M * 4), col = new Float32Array(M * 4), lvl = new Float32Array(M * 2);
    for (let i = 0; i < M; i++) {
      const t = items[i], o = i * 4;
      pos[o] = t.x; pos[o + 1] = t.y; pos[o + 2] = Math.max(0.0001, t.w); pos[o + 3] = Math.max(0.0001, t.h);
      col[o] = t.color[0]; col[o + 1] = t.color[1]; col[o + 2] = t.color[2]; col[o + 3] = t.color[3];
      lvl[i * 2] = t.level; lvl[i * 2 + 1] = t.under || 0;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tailPosSizeBuffer); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tailColorBuffer); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tailLevelBuffer); gl.bufferData(gl.ARRAY_BUFFER, lvl, gl.DYNAMIC_DRAW);
  }

  _drawTails(vpW: number, vpH: number) {
    const gl = this.gl, prog = this.tailProgram;
    if (!gl || !prog) return;
    if (!this._uniforms) this._uniforms = {};
    const U = this._uniforms.tail || (this._uniforms.tail = {
      u_matrix: gl.getUniformLocation(prog, 'u_matrix'), u_viewport: gl.getUniformLocation(prog, 'u_viewport'),
      u_offset: gl.getUniformLocation(prog, 'u_offset'), u_scale: gl.getUniformLocation(prog, 'u_scale'),
    });
    gl.useProgram(prog);
    gl.uniformMatrix3fv(U.u_matrix, false, this.matrix);
    gl.uniform2f(U.u_viewport, vpW, vpH);
    gl.uniform2f(U.u_offset, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
    gl.uniform2f(U.u_scale, this.xScalePxPerWU || 1.0, this.yScalePxPerWU || 1.0);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindVertexArray(this.tailVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.tailCount);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  init(containerEl: HTMLElement) {
    if (!containerEl) throw new Error('RendererAdapter.init: containerEl required');

    // Create canvas overlay (attach to body as fixed to escape Workspace stacking contexts)
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.pointerEvents = 'none'; // non-interactive overlay
    canvas.style.zIndex = '1004'; // above DOM bars/playhead; UI overlays use >=10000
    canvas.style.backgroundColor = 'transparent';

    // Ensure container is positioned (not strictly required when using fixed canvas, but harmless)
    const cs = window.getComputedStyle(containerEl);
    if (cs.position === 'static' || !cs.position) {
      containerEl.style.position = 'relative';
    }

    // Append to body to avoid being underneath Workspace's transformed stacking contexts
    document.body.appendChild(canvas);

    // Track and mirror container bounds to canvas CSS box
    const updateBounds = () => {
      try {
        const r = containerEl.getBoundingClientRect();
        canvas.style.left = `${r.left}px`;
        canvas.style.top = `${r.top}px`;
        canvas.style.width = `${Math.max(0, r.width)}px`;
        canvas.style.height = `${Math.max(0, r.height)}px`;
        // Keep offset in sync for world->screen conversions
        this.canvasOffset = { x: r.left, y: r.top };
      } catch {}
    };

    this.canvas = canvas;
    this._containerEl = containerEl;
    // Initial sync of canvas CSS box before GL init/resolution sizing
    try { updateBounds(); } catch {}

    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) {
      console.warn('WebGL2 not available');
      return false;
    }
    this.gl = gl;
    // Query hard GPU texture cap once
    try {
      this._maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || null;
    } catch {}

    this._resizeCanvasToDisplaySize();
    this._initPrograms();
    this._initGeometry();
    try { this._initGlyphCache(); } catch {}
    // Glyph atlas: ENABLED BY DEFAULT.
    // Overrides:
    //   - Disable with ?atlas=0 or localStorage 'rmt:atlas' === '0'
    //   - Enable explicitly with ?atlas=1 or localStorage 'rmt:atlas' === '1'
    try {
      const params = new URLSearchParams((typeof window !== 'undefined' && window.location && window.location.search) ? window.location.search : '');
      const q = params.get('atlas'); // '0' | '1' | null
      let override = null; // boolean | null
      if (q === '0') override = false;
      else if (q === '1') override = true;

      try {
        if (typeof localStorage !== 'undefined') {
          const ls = localStorage.getItem('rmt:atlas'); // '0' | '1' | null
          if (ls === '0') override = false;
          else if (ls === '1') override = true;
        }
      } catch {}

      // Default ON unless explicitly disabled
      this.useGlyphAtlas = (override != null) ? !!override : !!(this._config?.text?.useGlyphAtlasDefault ?? true);
      this._atlasEnabledFlagRead = true;

      if (this.useGlyphAtlas) {
        try { this._initGlyphAtlas(); } catch (e) { this.useGlyphAtlas = false; }
      }
    } catch {}

    // Helper to update cached canvas rect (avoids per-frame getBoundingClientRect)
    const updateCachedRect = () => {
      if (!this.canvas) return;
      try { this._cachedCanvasRect = this.canvas.getBoundingClientRect(); } catch {}
    };

    // Observe container resize and reposition canvas box accordingly
    this._resizeObserver = new ResizeObserver(() => {
      try { updateBounds(); } catch {}
      this._resizeCanvasToDisplaySize();
      updateCachedRect();
      this.needsRedraw = true;
    });
    this._resizeObserver.observe(containerEl);

    // Also track window scroll/resize to keep fixed canvas aligned with container
    this._onWinScroll = () => { try { updateBounds(); } catch {}; updateCachedRect(); this.needsRedraw = true; };
    this._onWinResize = () => { try { updateBounds(); } catch {}; this._resizeCanvasToDisplaySize(); updateCachedRect(); this.needsRedraw = true; };
    try {
      window.addEventListener('scroll', this._onWinScroll, true);
      window.addEventListener('resize', this._onWinResize, true);
    } catch {}

    // Initialize cached canvas rect
    try { this._cachedCanvasRect = this.canvas.getBoundingClientRect(); } catch {}

    // Start render loop
    const loop = () => {
      this._render();
      this.animHandle = window.requestAnimationFrame(loop);
    };
    this.animHandle = window.requestAnimationFrame(loop);

    return true;
  }

  destroy() {
    try {
      if (this.animHandle) cancelAnimationFrame(this.animHandle);
    } catch {}
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch {}
      this._resizeObserver = null;
    }
    // Remove global listeners used to keep fixed canvas aligned
    try {
      if (this._onWinScroll) window.removeEventListener('scroll', this._onWinScroll, true);
      if (this._onWinResize) window.removeEventListener('resize', this._onWinResize, true);
    } catch {}
    this._onWinScroll = null;
    this._onWinResize = null;

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this._containerEl = null;
    this.gl = null;
  }

  /**
   * Provide latest Workspace viewport basis (raw affine):
   * Expected object: { a, b, c, d, e, f }
   * Affine matrix (world -> screen), column-major mat3:
   * [ a c e ]
   * [ b d f ]
   * [ 0 0 1 ]
   */
  updateViewportBasis(raw: ReturnType<CameraController['getBasis']>) {
    if (!raw) return;

    // An unchanged basis is a no-op. player.js's rAF loop pushes a camera update on EVERY
    // frame (to release the tracking X-lock), so without this guard the renderer was
    // marked dirty and _viewEpoch was bumped 60x a second on a perfectly still canvas —
    // which both defeated the redraw gate and invalidated every view-keyed cache
    // (glyph runs, tab/arrow/divider regions, measure bars) every single frame.
    // Guarding here rather than only at the call site makes it robust to any caller.
    const m = this.matrix;
    if (m[0] === raw.a && m[1] === raw.b && m[3] === raw.c &&
        m[4] === raw.d && m[6] === raw.e && m[7] === raw.f) {
      return;
    }

    // Update matrix
    this.matrix[0] = raw.a; this.matrix[1] = raw.b; this.matrix[2] = 0;
    this.matrix[3] = raw.c; this.matrix[4] = raw.d; this.matrix[5] = 0;
    this.matrix[6] = raw.e; this.matrix[7] = raw.f; this.matrix[8] = 1;

    // Update X/Y scales (pixels per world-unit)
    const scaleX = Math.sqrt(raw.a * raw.a + raw.b * raw.b) || 1;
    const scaleY = Math.sqrt(raw.c * raw.c + raw.d * raw.d) || 1;
    this.xScalePxPerWU = scaleX;
    this.yScalePxPerWU = scaleY;
    if (this._xScaleAtInit == null) {
      this._xScaleAtInit = this.xScalePxPerWU;
    }
    
    // Cache the canvas offset for proper coordinate transformation
    if (this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      this.canvasOffset = { x: rect.left, y: rect.top };
    }

    // Bump epoch on any basis update (pan/zoom) so zoom-dependent screen-space buffers can refresh
    this._viewEpoch = (this._viewEpoch || 0) + 1;
 
    this.needsRedraw = true;
  }

  /**
   * Sync notes from evaluatedNotes/module into typed arrays for instanced rendering
   * expected: {
   *  evaluatedNotes, module, xScaleFactor, yScaleFactor, selectedNoteId
   * }
   */
  sync(args: SyncArgs) {
    this._syncInstances(args);
  }

  // A transposed repeat changes this label and the note inspector. Note positions
  // and frequency ratios on the canvas are relative to the same written base.
  syncBaseFrequencyLabel(evaluatedFrequency: Fraction | number | null | undefined) {
    // Keep the last label while an empty score is being initialized.
    try {
      const { factor } = getDisplayTransposition();
      const base = this._baseFreqExact;
      const frequency = factor && X.isRational(factor) && base && X.isRational(base) ? X.mul(base, factor) as Fraction
        : evaluatedFrequency ?? this._moduleRef?.baseNote?.getVariable?.('frequency');
      if (frequency == null) return;

      let num, den;
      if (typeof frequency === 'object' && frequency.n != null && frequency.d != null) {
        num = (frequency.s < 0 ? '-' : '') + String(frequency.n);
        den = String(frequency.d);
      } else if (typeof frequency === 'object' && typeof frequency.toFraction === 'function') {
        [num, den = '1'] = frequency.toFraction().split('/');
      } else {
        const hz = toNumber(frequency, NaN);
        if (!Number.isFinite(hz)) return;
        num = String(hz);
        den = '1';
      }
      const elide = (value: string) => {
        const negative = value.startsWith('-');
        const digits = negative ? value.slice(1) : value;
        if (digits.length <= 12) return value;
        return (negative ? '-' : '') + digits.slice(0, 6) + '…' + digits.slice(-4);
      };
      this._baseFracNum = elide(num);
      this._baseFracDen = elide(den);
      this.needsRedraw = true;
    } catch { /* Keep the previous label until a frequency is available. */ }
  }

  _syncInstances(args: SyncArgs): void {
    const { evaluatedNotes, module, xScaleFactor, yScaleFactor, selectedNoteId = null, tempOverrides = null } = args;
    if (!module) return;
    const partial = args.incremental && this._simpleInstances && this._moduleRef === module &&
      this._syncConfig === this._config && this.currentXScaleFactor === (xScaleFactor || 1) &&
      this.currentYScaleFactor === (yScaleFactor || 1) && !tempOverrides && !this._dragActive &&
      !this._hasPreviewGeometry && evaluatedNotes === module._evaluationCache &&
      !module._untrackedProperties && !module.getDependencyGraph().corruptionFlags.size
      ? module.evaluationChangesSince(this._syncRevision) : null;
    let dirty = partial && !partial.has(0) ? partial : null;
    if (dirty && this._restoredDragIds) {
      for (const id of this._restoredDragIds) dirty.add(id);
    }
    this._restoredDragIds = null;
    if (dirty && selectedNoteId !== this._lastSelectedNoteId) {
      for (const id of [this._lastSelectedNoteId, selectedNoteId, this._naturalLastId]) {
        if (id != null && this._noteIdToIndex.has(id)) dirty.add(id);
      }
    }
    if (dirty && [...dirty].some(id => !this._noteIdToIndex.has(id))) dirty = null;
    this._syncRevision = module._evaluationRevision;
    this._syncConfig = this._config;
    this._hasPreviewGeometry = !!tempOverrides;
    this.currentXScaleFactor = xScaleFactor || 1.0;
    this.currentYScaleFactor = yScaleFactor || 1.0;
    // Playhead derives world X at draw-time using currentXScaleFactor
    // Keep a module reference for on-the-fly computations (e.g., link lines during drag)
    // Loading a different module retires every per-note derived value, so drop the caches
    // that are keyed by note content rather than by note identity. They are bounded by the
    // note count within a module, so this is the only place they need to be released.
    if (this._moduleRef !== module) {
      for (const entry of this._ringBuffers?.values() || []) this.gl?.deleteBuffer(entry.buffer);
      this._ringBuffers?.clear();
      this._parsedColorCache = null;
      this._idColorCache = null;
      this._fracStrCache = null;
    }
    this._moduleRef = module;

    // Invalidate position- and selection-dependent data before rebuilding the scene.
    this._posEpoch = (this._posEpoch || 0) + 1;

    // CSS px -> world units (Y) for padding to match DOM borders
    const pxToWorldY = 1.0 / (this.yScalePxPerWU || 1.0);

    // Helper to access evaluatedNotes (handles both Map and object)
    const getEv = (id: number): RenderRecord | null | undefined => {
      if (!evaluatedNotes) return null;
      if ('get' in evaluatedNotes && typeof evaluatedNotes.get === 'function') return evaluatedNotes.get(id);
      return (evaluatedNotes as Record<number, RenderRecord>)[id];
    };

    // The BaseNote's exact frequency (src/value/exact.js), for exact note labels
    try {
      const b0 = getEv(0);
      this._baseFreqExact = (b0 && (b0.exact?.frequency ?? b0.frequency)) ?? module.baseNote.getExactVariable?.('frequency') ?? null;
    } catch { this._baseFreqExact = null; }

    // Resolve base frequency (fast path via evaluated cache)
    try {
      const baseEv = getEv(0)?.frequency;
      if (baseEv != null) {
        this._baseFreqCache = toNumber(baseEv, 440);
      } else {
        const bf = module.baseNote.getVariable('frequency');
        this._baseFreqCache = toNumber(bf, 0);
      }
    } catch {
      try {
        const bf = module.baseNote.getVariable('frequency');
        this._baseFreqCache = toNumber(bf, 0);
      } catch { this._baseFreqCache = 440; }
    }

    this.syncBaseFrequencyLabel(getEv(0)?.frequency);

    // Build list of visible notes (those with startTime and duration)
    const items = [];
    let hasComplexBodies = false;
    // What a note without an amplitude of its own inherits: the BaseNote's.
    const baseEvForAmp = getEv(0);
    const baseHeightScale = (baseEvForAmp && baseEvForAmp.amplitude) ? this._amplitudeHeightScale(baseEvForAmp.amplitude) : 1;
    // And its attack and release, which a note without its own inherits.
    const baseAttack = baseEvForAmp ? baseEvForAmp.attack : null;
    const baseRelease = baseEvForAmp ? baseEvForAmp.release : null;
    // Settings > Appearance > "Envelope inside notes": 'own' (the notes that set an
    // attack or a release), 'all', 'none'; and "Tails after the note's end".
    const envMode = this._config?.note?.envelopeMode || 'own';
    const showTails = this._config?.note?.showTails === true;
    // The tails to draw past the notes' ends (display only; see _drawTails).
    const tails = [];
    // Instruments resolved during this pass, by note id (see Module.findInstrument).
    const instrumentMemo = new Map<number, string>();
    const tailUnder = Math.max(0, this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0);
    // Latest end time across playable notes, accumulated here for free because this loop
    // already has each note's evaluated startTime/duration. _computeModuleEndTime used to
    // re-derive it with a second full pass over module.notes (~31ms at 100k notes).
    let maxNoteEndSec = dirty ? this._maxNoteEndSec : 0;
    let maxId = dirty ? this._maxNoteEndId : null;
    let lostMaximum = false;
    // Notes that only relate: a frequency and no duration (a tonic, a key, a root;
    // with a start, a key change from there on). Drawn as reference lines by
    // _renderReferenceLines, never as note bodies, never played.
    const refLines = [];
    const sourceIds = dirty || Object.keys(module.notes);
    for (const idStr of sourceIds) {
      const note = module.notes[idStr];
      if (!note) continue;
      // The BaseNote has a duration now (the time unit), but it never sounds and is not drawn as a note.
      if (Number(note.id) === 0) continue;
      // A measure bar has a start and a duration but is drawn as a bar line and a
      // triangle (_syncMeasureBars), never as a rest.
      if (isMeasureNote(note)) continue;
      try {
        // Use evaluatedNotes cache if available (required for correct display after reorder)
        const ev = getEv(note.id);
        const hasStart = ev ? (ev.startTime != null) : !!note.getVariable('startTime');
        const hasDur = ev ? (ev.duration != null) : !!note.getVariable('duration');
        if (!hasDur && note.hasExpression && note.hasExpression('frequency') && !note.hasExpression('duration')) {
          const fr: FrequencyShadow | null = (ev && ev.frequency != null) ? ev.frequency : note.getVariable('frequency');
          const fv = fr ? (fr._floatValue !== undefined && fr._irrational ? fr._floatValue : toNumber(fr, NaN)) : NaN;
          if (isFinite(fv) && fv > 0) {
            let startSec = null;
            if (hasStart) {
              const st = toNumber((ev && ev.startTime != null) ? ev.startTime : note.getVariable('startTime'), NaN);
              if (isFinite(st)) startSec = st;
            }
            refLines.push({ id: Number(note.id), freq: fv, startSec });
          }
          continue;
        }
        if (!hasStart || !hasDur) continue;

        // Prefer evaluated cache values to avoid stale data after module reorder
        const startTimeRaw = (ev?.startTime != null) ? toNumber(ev.startTime, NaN) : toNumber(note.getVariable('startTime'), NaN);
        const durationRaw  = (ev?.duration  != null) ? toNumber(ev.duration,  NaN) : toNumber(note.getVariable('duration'),  NaN);
        const freqRaw: FrequencyShadow | null | undefined = ev?.frequency;
        // For irrational/corrupted frequencies (or large fractions that overflow u32),
        // use _floatValue if available for precision
        let freqVal = null;
        if (freqRaw != null) {
          if (freqRaw._irrational && freqRaw._floatValue !== undefined) {
            freqVal = freqRaw._floatValue;
          } else {
            freqVal = toNumber(freqRaw, null);
          }
        } else {
          const noteFreq: FrequencyShadow | null = note.getVariable('frequency');
          if (noteFreq) {
            freqVal = noteFreq._floatValue ?? toNumber(noteFreq, null);
          }
        }

        // Skip notes with invalid (NaN/undefined) startTime or duration
        const startTime = (typeof startTimeRaw === 'number' && isFinite(startTimeRaw)) ? startTimeRaw : null;
        const duration = (typeof durationRaw === 'number' && isFinite(durationRaw)) ? durationRaw : null;
        if (startTime === null || duration === null) continue;

        // Module end time follows the COMMITTED geometry (pre-override), and counts only
        // notes that actually sound — same predicate _computeModuleEndTime used.
        if (note.hasExpression && note.hasExpression('frequency')) {
          const end = startTime + duration;
          if (dirty && note.id === this._maxNoteEndId && end < this._maxNoteEndSec) lostMaximum = true;
          if (end > maxNoteEndSec) { maxNoteEndSec = end; maxId = note.id; }
        }

        // World coords with optional temp overrides (e.g., dragging/resizing)
        const ov = tempOverrides && tempOverrides[note.id] ? tempOverrides[note.id] : null;
        const startSec = (ov && ov.startSec != null) ? ov.startSec : startTime;
        const durSec   = (ov && ov.durationSec != null) ? ov.durationSec : duration;

        const x = startSec * this._cfgSX() * this.currentXScaleFactor;
        const w = Math.max(0.0001, durSec * this._cfgSX() * this.currentXScaleFactor); // Minimum width to prevent invisible notes
        let y = (freqVal != null)
          ? this._frequencyToY(freqVal)
          : this._yForSilence(module, note, evaluatedNotes);

        // Pin the note's vertical CENTRE to its frequency line, then derive the
        // top-left from the height. At the default height this is identical to the
        // old fixed -1 shift (anchor 10 - 22/2 = -1); at any other height the note
        // stays centred on its line instead of drifting off it.
        // The height also shows the note's amplitude (silences have none).
        const isSilence = (freqVal == null || !isFinite(Number(freqVal)));
        const heightScale = isSilence ? 1 : ((ev && ev.amplitude) ? this._amplitudeHeightScale(ev.amplitude) : baseHeightScale);
        const h = this._cfgNoteH() * heightScale; // world units
        y = y + this._cfgCenterAnchor() - h * 0.5;

        const baseColor = this._resolveColor(ev, note, module);
        const color = isSilence ? [0.0, 0.0, 0.0, 0.75] : baseColor;

        // The envelope a note sounds with, drawn inside it (see rectBorderFS) as the
        // "Envelope inside notes" setting says: by default when the note or the
        // BaseNote sets an attack or a release. Otherwise null, and the note draws
        // exactly as before. Its tail, past its end, when tails are on.
        let env = null;
        if (!isSilence) {
          const atk = (ev && ev.attack) || baseAttack;
          const rel = (ev && ev.release) || baseRelease;
          const inside = envMode === 'all' || (envMode === 'own' && !!(atk || rel));
          if (inside || showTails) {
            const e = this._envelopeSharesFor(module, note, durSec, atk, rel, freqVal, instrumentMemo);
            if (e) {
              if (inside) env = e;
              // The tail starts under the note, one corner radius in (the radius is in
              // world units along x: rectBorderFS scales it by the same px-per-unit as
              // the note), so the note's rounded corners sit over it instead of leaving
              // a notch between the note and its tail.
              if (showTails && e[4] > 0) tails.push({ x: x + w, y, w: w * e[4], h, color, level: e[5], under: Math.min(tailUnder, w * 0.5) });
            }
          }
        }

        // Carry freqVal so the fraction-label pass below does not have to look the note up in
        // evaluatedNotes a second time and re-unwrap the Fraction.
        // The exact frequency (Fraction, or an exact Irrational / Approx) for the label
        const freqExact = ev ? (ev.exact?.frequency ?? ev.frequency ?? null) : null;
        if (isSilence || env) hasComplexBodies = true;
        items.push({ id: note.id, x, y, w, h, color, isSilence, freqVal, freqExact, env });
      } catch {
        // Ignore malformed notes
      }
    }
    // Complex scenes use the same full path as load. A changed maximum
    // that moved earlier also requires finding the next latest note.
    if (dirty && (items.length !== dirty.size || hasComplexBodies || lostMaximum)) {
      return this._syncInstances({ ...args, incremental: false });
    }
    this._maxNoteEndId = maxId;
    this._maxNoteEndSec = maxNoteEndSec;
    if (!dirty) {
      this._refLines = refLines;
      this._tailItems = tails;
    }

    // PERFORMANCE: Instead of O(n log n) sort, use O(1) swap to move selected note to end
    // This avoids full buffer reallocation on every selection change
    if (dirty) {
      const swapWithLast = (id: number | null | undefined) => {
        if (id == null || !this._instanceNoteIds) return;
        const index = this._noteIdToIndex.get(id), last = this.instanceCount - 1;
        if (index == null || index === last) return;
        const top = this._instanceNoteIds[last];
        this._instanceNoteIds[index] = top;
        this._instanceNoteIds[last] = id;
        this._noteIdToIndex.set(top, index);
        this._noteIdToIndex.set(id, last);
      };
      if (selectedNoteId !== this._lastSelectedNoteId) {
        // Undo the previous selection swap, then apply the new one.
        swapWithLast(this._naturalLastId);
        swapWithLast(selectedNoteId);
      }
    } else {
      this._naturalLastId = items.at(-1)?.id;
    }
    if (!dirty && selectedNoteId != null) {
      const selIdx = items.findIndex(it => it.id === selectedNoteId);
      if (selIdx >= 0 && selIdx < items.length - 1) {
        // Swap selected item with the last item (O(1) instead of O(n log n) sort)
        const lastIdx = items.length - 1;
        const temp = items[lastIdx];
        items[lastIdx] = items[selIdx];
        items[selIdx] = temp;
      }
    }

    // Allocate/resize typed arrays only when count changes
    const N = dirty ? this.instanceCount : items.length;
    if (!this.colors || !this.posSize || this.posSize.length !== N * 4) {
      this.posSize = new Float32Array(N * 4);
      this.colors  = new Float32Array(N * 4);
      // Use Int32 to avoid precision loss for large numeric IDs (prevents wrong highlight/pick)
      this._instanceNoteIds = new Int32Array(N);
      this._instanceFlags = new Float32Array(N);
      this._dragFlags = new Float32Array(N);
      this._corruptionType = new Float32Array(N);
    }
    if (!this._envShape || this._envShape.length !== N * 4) {
      this._envShape = new Float32Array(N * 4);
    }

    // Fill arrays with reordered data
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const i = dirty ? this._noteIdToIndex.get(it.id)! : k;
      const o = i * 4;
      this.posSize[o + 0] = it.x;
      this.posSize[o + 1] = it.y;
      this.posSize[o + 2] = Math.max(0.0001, it.w);
      this.posSize[o + 3] = Math.max(0.0001, it.h);


      this.colors[o + 0] = it.color[0];
      this.colors[o + 1] = it.color[1];
      this.colors[o + 2] = it.color[2];
      this.colors[o + 3] = it.color[3];

      // Envelope shape (attack, decay, sustain, release); all zeros = none drawn
      const env = it.env;
      this._envShape[o + 0] = env ? env[0] : 0;
      this._envShape[o + 1] = env ? env[1] : 0;
      this._envShape[o + 2] = env ? env[2] : 0;
      this._envShape[o + 3] = env ? env[3] : 0;

      // Per-instance flags: 1 for silence, 0 otherwise
      if (this._instanceFlags) {
        this._instanceFlags[i] = it.isSilence ? 1.0 : 0.0;
      }

      // Maintain parallel note id array for CPU picking in draw order (selected last on top)
      if (this._instanceNoteIds) {
        this._instanceNoteIds[i] = (it.id | 0);
      }
    }
 
    // Rebuild id->index map for fast per-instance updates
    if (!dirty) try {
      this._noteIdToIndex = new Map();
      for (let i = 0; i < N; i++) {
        const idVal = (items[i] && items[i].id != null) ? Number(items[i].id) : null;
        if (idVal != null) this._noteIdToIndex.set(idVal, i);
      }
    } catch {}

    // Compute corruption type for hatching display (0=none, 1=transitive, 2=direct)
    // Always reset to 0 first to avoid stale data
    if (!dirty && this._corruptionType) {
      this._corruptionType.fill(0.0);
    }
    try {
      const depGraph = module?.getDependencyGraph?.();
      if (depGraph && this._corruptionType && typeof depGraph.isNoteCorrupted === 'function') {
        // PERFORMANCE (Phase 8): the old path called getAllDependencies() — a full
        // transitive BFS — for EVERY note EVERY sync, making this block O(N^2) on deep
        // dependency chains (measured: ~28ms of a 46ms commit at chain-1000). The corrupt
        // set is empty in the overwhelmingly common case, and even when non-empty it is
        // tiny. Compute "has a corrupt note in its dependency closure" for all notes with
        // ONE multi-source BFS over the *dependents* graph seeded by the corrupt set.
        // Equivalent because `dependents` is the maintained inverse of `dependencies`:
        //   i depends (transitively) on corrupt C  <=>  i is a transitive dependent of C.
        const canFast = typeof depGraph.getCorruptedNotes === 'function'
          && typeof depGraph.getDependents === 'function';
        if (canFast) {
          const corruptSet = depGraph.getCorruptedNotes();
          if (corruptSet && corruptSet.size > 0) {
            // hasCorruptDep = { every transitive dependent of any corrupt note }.
            const hasCorruptDep = new Set<number>();
            const queue = [];
            for (const c of corruptSet) queue.push(c);
            const enqueued = new Set(queue);
            let qi = 0;
            while (qi < queue.length) {
              const cur = queue[qi++];
              const deps = depGraph.getDependents(cur);
              if (deps) {
                for (const d of deps) {
                  hasCorruptDep.add(d);
                  if (!enqueued.has(d)) { enqueued.add(d); queue.push(d); }
                }
              }
            }
            for (let i = 0; i < N; i++) {
              const noteId = Number(items[i]?.id ?? 0);
              const isCorrupt = corruptSet.has(noteId);
              const hcd = hasCorruptDep.has(noteId);
              // Direct (2.0) = corrupt with no corrupt dependency; transitive (1.0) =
              // corrupt-with-corrupt-dep OR clean-but-depends-on-corrupt; else 0 (already filled).
              if (isCorrupt) this._corruptionType[i] = hcd ? 1.0 : 2.0;
              else if (hcd) this._corruptionType[i] = 1.0;
            }
          }
          // corruptSet empty -> _corruptionType already all-zeros (fill above): no work.
        } else if (typeof depGraph.getAllDependencies === 'function') {
          // Fallback for older graph instances lacking the fast-path APIs: exact prior logic.
          for (let i = 0; i < N; i++) {
            const noteId = Number(items[i]?.id ?? 0);
            const isDirectlyCorrupt = depGraph.isNoteCorrupted(noteId);
            if (isDirectlyCorrupt) {
              let hasCorruptDependency = false;
              const allDeps = depGraph.getAllDependencies(noteId);
              if (allDeps && allDeps.size > 0) {
                for (const depId of allDeps) {
                  if (depGraph.isNoteCorrupted(depId)) { hasCorruptDependency = true; break; }
                }
              }
              this._corruptionType[i] = hasCorruptDependency ? 1.0 : 2.0;
            } else {
              const allDeps = depGraph.getAllDependencies(noteId);
              let isTransitive = false;
              if (allDeps && allDeps.size > 0) {
                for (const depId of allDeps) {
                  if (depGraph.isNoteCorrupted(depId)) { isTransitive = true; break; }
                }
              }
              this._corruptionType[i] = isTransitive ? 1.0 : 0.0;
            }
          }
        }
      }
    } catch {}

    // Compute related highlight index sets from module when a note is selected
    try {
      // Base selection draws its own ring. Its score-wide relation rings and lines are hidden.
      if (selectedNoteId != null && selectedNoteId !== 0 && module && typeof module.getDirectDependencies === 'function' && this._noteIdToIndex) {
        const selIdNum = Number(selectedNoteId);
        const deps = module.getDirectDependencies(selIdNum) || [];
        const depsByProperty = module.getDirectDependenciesByProperty?.(selIdNum) ||
          { frequency: [], startTime: [], duration: [] };
        const trees = this._selectionTrees(module, selIdNum);
        const fallback = trees ? null : module.getDependentsByProperty?.(selIdNum);

        const toIdx = (id: number) => this._noteIdToIndex.get(Number(id));
        const selIdx = toIdx(selIdNum);
        const measureIds = module.getTimingSummary?.()?.measureIds;
        const isBarId = (id: number) => measureIds ? measureIds.has(id) : isMeasureNote(module.getNoteById(id));
        this._relDepsMeasureIds = deps.filter(isBarId);
        this._relDepsHasBase = deps.includes(0);
        this._relDepsIdx = deps.map(toIdx).filter((i): i is number => i != null && i !== selIdx);

        // Uncolored dependencies can include properties other than pitch, start
        // and duration. Only bars, a dependent BaseNote, and optional drag ghosts
        // consume that separate traversal. Keep it exact whenever they need it.
        const needAll = !trees || !measureIds || measureIds.size ||
          module.getDirectDependencies(0).some(id => id !== 0) || this.drawDragGhosts;
        const rdeps = needAll ? module.getDependentNotes?.(selIdNum) || [] : null;
        this._relRdepsMeasureIds = rdeps?.filter(isBarId) || [];
        this._relRdepsHasBase = rdeps?.includes(0) || false;
        this._relRdepsIdx = rdeps?.map(toIdx).filter((i): i is number => i != null && i !== selIdx) ?? null;

        // The edges already visited for the colored lines identify the same
        // affected notes as the three property traversals. A child reached by
        // two changed properties needs only one ring of each origin color.
        const indices: ByRelation<number[]> = { frequency: [], startTime: [], duration: [] };
        const hasBase = { frequency: false, startTime: false, duration: false };
        let seen;
        let bit = 1;
        for (const prop of ['frequency', 'startTime', 'duration'] as const) {
          const list = trees ? trees.edgesByProperty[prop] : fallback?.[prop] || [];
          if (list.length && !seen) seen = new Uint8Array(N);
          for (const entry of list) {
            const id = typeof entry === 'number' ? entry : entry.childId;
            if (id === 0) hasBase[prop] = true;
            const idx = toIdx(id);
            if (idx != null && idx !== selIdx && !(seen![idx] & bit)) {
              indices[prop].push(idx);
              seen![idx] |= bit;
            }
          }
          bit <<= 1;
        }
        this._relRdepsIdxByProperty = indices;
        this._relRdepsHasBaseByProperty = hasBase;

        // Compute property-colored indices for deps (dependencies)
        const depsIdxByProp: ByRelation<number[]> = { frequency: [], startTime: [], duration: [] };
        for (const prop of ['frequency', 'startTime', 'duration'] as const) {
          const propIds = depsByProperty[prop] || [];
          const propIdxSet = new Set<number>();
          for (const id of propIds) {
            const ii = toIdx(id);
            if (ii != null && ii !== selIdx) propIdxSet.add(ii);
          }
          depsIdxByProp[prop] = Array.from(propIdxSet);
        }
        this._relDepsIdxByProperty = depsIdxByProp;

        // Compute base flags per property
        this._relDepsHasBaseByProperty = {
          frequency: (depsByProperty.frequency || []).includes(0),
          startTime: (depsByProperty.startTime || []).includes(0),
          duration: (depsByProperty.duration || []).includes(0)
        };

        // Compute full parent chains per property for segmented line visualization
        // Each chain is an array of note IDs from the selected note back to baseNote
        const chainsByProp: ByRelation<number[]> = { frequency: [], startTime: [], duration: [] };
        const chainIdxByProp: ByRelation<number[]> = { frequency: [], startTime: [], duration: [] };
        if (typeof module.getParentChainByProperty === 'function') {
          for (const prop of ['frequency', 'startTime', 'duration'] as const) {
            const chain = module.getParentChainByProperty(selIdNum, prop);
            chainsByProp[prop] = chain;
            // Convert chain to indices (excluding baseNote which is handled separately)
            const chainIdxSet = new Set<number>();
            for (const id of chain) {
              if (id === 0) continue; // baseNote handled via _relDepsHasBaseByProperty
              const ii = toIdx(id);
              if (ii != null && ii !== selIdx) chainIdxSet.add(ii);
            }
            chainIdxByProp[prop] = Array.from(chainIdxSet);
          }
        }
        this._relDepsChainByProperty = chainsByProp;
        this._relDepsChainIdxByProperty = chainIdxByProp;
      } else {
        this._relDepsIdx = null;
        this._relRdepsIdx = null;
        this._relDepsMeasureIds = null;
        this._relRdepsMeasureIds = null;
        this._relDepsHasBase = false;
        this._relRdepsHasBase = false;
        // Clear property-colored arrays
        this._relRdepsIdxByProperty = { frequency: null, startTime: null, duration: null };
        this._relDepsIdxByProperty = { frequency: null, startTime: null, duration: null };
        this._relRdepsHasBaseByProperty = { frequency: false, startTime: false, duration: false };
        this._relDepsHasBaseByProperty = { frequency: false, startTime: false, duration: false };
        // Clear chain data
        this._relDepsChainByProperty = { frequency: [], startTime: [], duration: [] };
        this._relDepsChainIdxByProperty = { frequency: [], startTime: [], duration: [] };
        // Clear cache when no selection
        this._linkTreeCache = null;
      }
    } catch { this._relDepsIdx = null; this._relRdepsIdx = null; }
 
    // Compute per-note fraction label strings (relative to base) for overlay rendering.
    // A full pass compares fresh arrays. A partial pass writes affected slots in place
    // and invalidates the text cache explicitly.
    if (!dirty) this._noteFracNumStrs = new Array(N);
    if (!dirty) this._noteFracDenStrs = new Array(N);
    // 1 where the label is drawn with ≈: an approximate value, or an exact one too long to show
    if (!dirty) this._noteLabelApprox = new Uint8Array(N);
    const baseValNum = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
    const baseExact = this._baseFreqExact;
    const fracCache = this._fracStrCache || (this._fracStrCache = new Map<number, string[]>());
    // Exact labels, memoised per value object: a record keeps its Fraction / exact value
    // until the note is re-evaluated, so a steady sync costs one WeakMap lookup per note.
    const exactCache = (this._labelCacheBase === baseExact && this._exactLabelCache) || new WeakMap<X.ExactValue, ReturnType<typeof noteLabel>>();
    this._exactLabelCache = exactCache;
    this._labelCacheBase = baseExact;
    const approxFrac = (ratio: number) => {
      let pair = fracCache.get(ratio);
      if (pair === undefined) {
        const fr = (typeof this._approximateFraction === 'function') ? this._approximateFraction(ratio, 8192, 4) : { n: Math.round(ratio * 1000), d: 1000 };
        pair = [String(fr.n), String(fr.d)];
        if (fracCache.size > 65536) fracCache.clear();
        fracCache.set(ratio, pair);
      }
      return pair;
    };
    for (let k = 0; k < items.length; k++) {
      const i = dirty ? this._noteIdToIndex.get(items[k].id)! : k;
      if (dirty) this._noteLabelApprox[i] = 0;
      try {
        // items[k] is instance i (the selected-note swap above keeps them aligned), and its
        // freqVal was already resolved in the note loop — including the raw-variable fallback
        // that avoids a transient "silence" label at initial load. Re-reading evaluatedNotes
        // here was a second Map lookup plus a Fraction unwrap for every note.
        const fnum = items[k].freqVal;
        const fex = items[k].freqExact;
        if (fnum != null && isFinite(fnum) && baseValNum && isFinite(baseValNum) && baseValNum !== 0) {
          // The label states the note's exact relation to the BaseNote (note-label.js): a
          // pure ratio as its fraction, a tempered note as its power, ≈ only for an
          // approximation or an exact value too long for the label.
          let label = (fex && typeof fex === 'object' && baseExact) ? exactCache.get(fex) : undefined;
          if (label === undefined && fex && typeof fex === 'object' && baseExact) {
            label = noteLabel(fex, baseExact) || null;
            exactCache.set(fex, label);
          }
          if (label) {
            if ('approx' in label) {
              const pair = approxFrac(fnum / baseValNum);
              this._noteFracNumStrs[i] = pair[0];
              this._noteFracDenStrs[i] = pair[1];
              this._noteLabelApprox[i] = 1;
            } else {
              this._noteFracNumStrs[i] = label.num;
              this._noteFracDenStrs[i] = label.den;
            }
          } else {
            // No exact value at hand: the float ratio, as before
            const pair = approxFrac(fnum / baseValNum);
            this._noteFracNumStrs[i] = pair[0];
            this._noteFracDenStrs[i] = pair[1];
            if (this._corruptionType && this._corruptionType[i] > 0) this._noteLabelApprox[i] = 1;
          }
        } else {
          // Only mark as 'silence' when we truly lack/invalid frequency even after fallback
          this._noteFracNumStrs[i] = 'silence';
          this._noteFracDenStrs[i] = '';
        }
      } catch {
        this._noteFracNumStrs[i] = 'silence';
        this._noteFracDenStrs[i] = '';
      }
    }

    this.instanceCount = N;
    if (dirty) {
      const slots = [...dirty].map(id => this._noteIdToIndex.get(id)!).sort((a, b) => a - b);
      this._rangeIndex?.update(this.posSize, slots);
      this._uploadChangedInstances(slots);
    } else {
      this._rangeIndex = N >= 512 ? new InstanceRanges(this.posSize) : null;
      this._simpleInstances = typeof module.evaluationChangesSince === 'function' && evaluatedNotes instanceof Map &&
        !tempOverrides && !showTails && !hasComplexBodies &&
        !module.getDependencyGraph().corruptionFlags.size;
    }
    this._lastSyncWasPartial = !!dirty;
    this._syncTails();

    // Upload to GPU
    if (!dirty && this.gl && this.rectInstancePosSizeBuffer && this.rectInstanceColorBuffer) {
      const gl = this.gl;
 
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.posSize, gl.DYNAMIC_DRAW);
 
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.DYNAMIC_DRAW);
 
      // Upload per-instance flags once here (silence mask) to avoid per-frame uploads
      if (this.rectInstanceFlagsBuffer && this._instanceFlags) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceFlagsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._instanceFlags, gl.DYNAMIC_DRAW);
      }

      // Initialize drag flags buffer with zeros (no drag offset initially)
      if (this.rectInstanceDragFlagsBuffer && this._dragFlags) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDragFlagsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._dragFlags, gl.DYNAMIC_DRAW);
      }

      // Upload corruption type buffer for hatching display
      // Note: Must upload every sync because item order changes when selection changes
      // (selected note is swapped to end of array), so epoch-gating would cause stale data
      if (this.rectInstanceCorruptionBuffer && this._corruptionType) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceCorruptionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._corruptionType, gl.DYNAMIC_DRAW);
      }
      // Envelope shapes follow the same order, so they are uploaded with it
      if (this.rectInstanceEnvBuffer && this._envShape) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceEnvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._envShape, gl.DYNAMIC_DRAW);
      }

      // Ensure all enabled per-instance attribute buffers are large enough for instanceCount draws
      // Provide zero-initialized defaults for region buffers to prevent ANGLE/D3D buffer underruns.
      // PERFORMANCE (Phase 8): reuse a cached zero buffer instead of allocating a fresh
      // Float32Array every sync — during drag, sync runs each frame, so this removes a
      // per-frame ~instanceCount*16-byte allocation (GC churn) with identical GPU behavior
      // (the cache is only ever read, never written, so it stays all-zeros).
      const instCount = Math.max(0, this.instanceCount | 0);
      if (!this._zeros4Cache || this._zeros4Cache.length !== instCount * 4) {
        this._zeros4Cache = new Float32Array(instCount * 4);
      }
      const zeros4 = this._zeros4Cache;
      try {
        if (this.rectInstanceTabRegionBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
          // Keep attribute 4 pointing to primary region buffer
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(4, 1);
        }
      } catch {}
      try {
        if (this.rectInstanceTabInnerBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
        }
      } catch {}
      try {
        if (this.rectInstanceArrowRegionBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
        }
        // The lower half has its own buffer and must be resized to the new instance count
        // alongside the upper one, or an N-instance draw would read past its end.
        if (this.rectInstanceArrowDownRegionBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowDownRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
        }
      } catch {}
      try {
        if (this.rectInstanceDividerRegionBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDividerRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
        }
      } catch {}
 
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // Bump scene epoch to signal sync completion for overlay passes.
    // Note: _posEpoch was bumped at start of sync() for cache invalidation.
    // Using separate _sceneEpoch avoids double-invalidation of dependency highlight cache.
    this._sceneEpoch = (this._sceneEpoch || 0) + 1;

    // Invalidate cached tab/arrow regions after scene changes.
    // The *upload* epochs must be invalidated alongside the *data* epochs. sync() has just
    // zeroed the region buffers above, and the arrow pass only re-uploads when
    // _lastArrowUploadEpoch !== _lastArrowEpoch. Resetting only _lastArrowEpoch let the
    // rebuild restore it to the very same _viewEpoch the last upload was stamped with, so the
    // upload was skipped and the zeroed buffers were drawn — arrows vanished after any edit.
    // This was masked before only because _viewEpoch used to change on every single frame.
    this._lastTabEpoch = -1;
    this._lastArrowEpoch = -1;
    this._lastArrowUploadEpoch = -1;
    this._arrowRegionsDirty = true;
    this._lastDividerEpoch = -1;
    this._lastDividerUploadEpoch = -1;

    // Mark dirty to trigger one-time uploads/draw ordering updates
    this._sceneDirty = true;

    // Determine if text content or selection changed (avoid forcing text rebuild on every sync)
    const prevNum = this._lastNoteFracNumStrs;
    const prevDen = this._lastNoteFracDenStrs;
    const prevApx = this._lastNoteLabelApprox;
    let contentChanged = !!dirty;
    if (contentChanged || !prevNum || !prevDen || !prevApx || prevNum.length !== this._noteFracNumStrs.length || prevDen.length !== this._noteFracDenStrs.length) {
      contentChanged = true;
    } else {
      for (let i = 0; i < this._noteFracNumStrs.length; i++) {
        if (this._noteFracNumStrs[i] !== prevNum[i] || this._noteFracDenStrs[i] !== prevDen[i] || this._noteLabelApprox[i] !== prevApx[i]) { contentChanged = true; break; }
      }
    }
    const selChanged = (this._lastSelectedNoteId !== (selectedNoteId == null ? null : selectedNoteId));
    this._lastSelectedNoteId = (selectedNoteId == null ? null : selectedNoteId);

    // Persist current snapshot for next-diff
    this._lastNoteFracNumStrs = this._noteFracNumStrs;
    this._lastNoteFracDenStrs = this._noteFracDenStrs;
    this._lastNoteLabelApprox = this._noteLabelApprox;

    // Rebuild glyph runs only when necessary; viewport changes are handled by _lastTextViewEpoch gating in _render()
    // PERFORMANCE: Selection change doesn't affect text content (fractions, "silence"), only ring/highlights
    // so we don't mark text dirty for selection changes - just need redraw for the visual updates
    this._textDirty = contentChanged || (this.instanceCount !== this._lastInstanceCount);
    this._lastInstanceCount = this.instanceCount;

    // _noteIdToIndex was just rebuilt above; the cached multi-selection indices refer to the
    // OLD instance order and would highlight the wrong notes if left alone.
    try { this._resolveMultiSelIndices(); } catch {}

    this.needsRedraw = true;
  }

  setPlayhead(timeSec: number) {
    const t = (typeof timeSec === 'number') ? timeSec : 0;
    // Keep legacy world-x in sync for any consumers reading it prior to render
    this.playheadXWorld = t * this._cfgSX() * (this.currentXScaleFactor || 1.0);
    if (t === this.playheadTimeSec) return;
    this.playheadTimeSec = t;
    // The line is pixel-snapped. At score overview scales, several seconds can
    // elapse before it reaches another pixel. Camera changes dirty their own frames.
    const x = this.matrix[0] * this.playheadXWorld + this.matrix[6] - this.canvasOffset.x;
    if (this.trackingMode || this.needsRedraw) return;
    const last = this._lastPlayheadLocalX;
    if (last == null) { this.needsRedraw = true; return; }
    const left = Math.round(x) - 0.5;
    const previousLeft = Math.round(last) - 0.5;
    if (left === previousLeft) return;
    const width = this._cachedCanvasRect?.width ?? Infinity;
    const thickness = this._config?.playhead?.thicknessPx ?? 1;
    // Redraw once to erase a departing line, then leave the stationary score alone.
    if ((left < width && left + thickness > 0) ||
        (previousLeft < width && previousLeft + thickness > 0)) this.needsRedraw = true;
  }

  // Public API: set hovered note id for hover ring rendering
  // Public API: update only scale factors without rebuilding scene. This prevents a 1-frame playhead pop
  // when the x-scale slider updates the camera basis before the renderer receives new scale factors.
  setScaleFactors(x: number, y: number) {
    try {
      if (typeof x === 'number' && isFinite(x)) this.currentXScaleFactor = x;
      if (typeof y === 'number' && isFinite(y)) this.currentYScaleFactor = y;
      this.needsRedraw = true;
    } catch {}
  }

  // Public API: toggle tracking mode. When enabled, playhead renders at viewport center in screen space,
  // eliminating any transient mismatch between camera basis updates and world-scale updates.
  setTrackingMode(enabled: boolean) {
    try {
      this.trackingMode = !!enabled;
      this.needsRedraw = true;
    } catch {}
  }

  // Public API: show/hide the octave-arrow column.
  // Use this rather than assigning drawNoteArrows directly: the id label, the fraction and its
  // divider are all laid out around that column, so toggling it RELAYOUTS them into (or out of)
  // the reclaimed space. Their cached glyph runs and note-local regions therefore have to be
  // rebuilt — a bare needsRedraw would just redraw the stale layout.
  setDrawNoteArrows(enabled: boolean) {
    try {
      const v = !!enabled;
      if (this.drawNoteArrows === v) return;
      this.drawNoteArrows = v;
      this._textDirty = true;
      this._viewEpoch = (this._viewEpoch || 0) + 1;
      this.needsRedraw = true;
    } catch {}
  }
  // Clearing: pass null/undefined to remove hover highlight.
  setHoverNoteId(noteId: number | null) {
    try {
      const id = (noteId == null) ? null : Number(noteId);
      if (this._hoveredNoteId !== id) {
        this._hoveredNoteId = id;
        this.needsRedraw = true;
      }
    } catch {
      // On any error, clear hover and request redraw
      this._hoveredNoteId = null;
      this.needsRedraw = true;
    }
  }

  // Public API: set hovered MEASURE id (triangle)
  setHoverMeasureId(measureId: number | null) {
    try {
      const id = (measureId == null) ? null : Number(measureId);
      if (this._hoveredMeasureId !== id) {
        this._hoveredMeasureId = id;
        this.needsRedraw = true;
      }
    } catch {
      this._hoveredMeasureId = null;
      this.needsRedraw = true;
    }
  }

  // Public API: set BaseNote hover flag
  setHoverBase(flag: boolean) {
    try {
      const v = !!flag;
      if (this._hoverBase !== v) {
        this._hoverBase = v;
        this.needsRedraw = true;
      }
    } catch {
      this._hoverBase = false;
      this.needsRedraw = true;
    }
  }

  // Public API: set hovered sub-region target for background emphasis
  // target: null to clear, or { id: number, region: 'tab'|'octaveUp'|'octaveDown' }
  setHoverSubRegion(target: {id: number; region: string} | null) {
    try {
      const next = (target && typeof target === 'object' && target.id != null && target.region)
        ? { id: Number(target.id), region: String(target.region) }
        : null;
      const cur = this._hoverSub;
      const changed = !cur || !next || cur.id !== next.id || cur.region !== next.region;
      if (changed) {
        this._hoverSub = next;
        this.needsRedraw = true;
      }
    } catch {
      this._hoverSub = null;
      this.needsRedraw = true;
    }
  }

  // Public API: set prospective parent candidate id for live link-line remapping during drag
  // Pass null to clear. Accepts 0 for BaseNote.
  setProspectiveParentId(parentId: number | null) {
    try {
      const pid = (parentId == null) ? null : Number(parentId);
      if (this._prospectiveParentId !== pid) {
        this._prospectiveParentId = pid;
        // During active drag, avoid epoch bumps that trigger heavy link-line rebuilds each frame.
        if (!this._dragActive) {
          this._posEpoch = (this._posEpoch || 0) + 1;
        }
        this.needsRedraw = true;
      }
    } catch {
      // Safe no-op on failure
    }
  }

  // Public API: set the multi-selection (marquee / additive selection).
  // Accepts any iterable of note or measure ids; null/empty clears it.
  // Ids that are not currently present in the scene are skipped silently.
  setMultiSelection(ids: Iterable<number> | null) {
    try {
      let next = null;
      if (ids) {
        for (const raw of ids) {
          const id = Number(raw);
          if (!Number.isFinite(id)) continue;
          if (!next) next = new Set<number>();
          next.add(id);
        }
      }
      if (next && next.size === 0) next = null;

      const prev = this._multiSelIds;
      if (!next && !prev) return;
      if (next && prev && next.size === prev.size) {
        let same = true;
        for (const id of next) { if (!prev.has(id)) { same = false; break; } }
        if (same) return;
      }

      this.syncMultiSelection(next);
    } catch {
      this._multiSelIds = null;
      this._multiSelNoteIdx = null;
      this.needsRedraw = true;
    }
  }

  // player.js owns this Set and calls here after each mutation. Keep one copy
  // of the IDs when committing a large group. The public setter above takes
  // a snapshot of an arbitrary caller's iterable.
  syncMultiSelection(ids: Set<number> | null) {
    this._multiSelIds = ids?.size ? ids : null;
    this._resolveMultiSelIndices();
    this.needsRedraw = true;
  }

  // Public API: current multi-selection as an array of ids (empty when none).
  getMultiSelection() {
    const rect = this._marqueeRect;
    if (rect) {
      const hits = this.pickRectIds(rect.x0, rect.y0, rect.x1, rect.y1);
      if (rect.seedId != null && !hits.includes(rect.seedId)) hits.push(rect.seedId);
      return rect.additive && this._multiSelIds ? [...new Set([...this._multiSelIds, ...hits])] : hits;
    }
    return this._multiSelIds ? Array.from(this._multiSelIds) : [];
  }

  // Public API: rubber-band rectangle in CLIENT CSS px ({x0,y0,x1,y1}), or null to hide.
  setMarqueeRect(rect: Marquee | null) {
    try {
      if (!rect) {
        if (!this._marqueeRect) return;
        this._marqueeRect = null;
        this.needsRedraw = true;
        return;
      }
      const x0 = Number(rect.x0), y0 = Number(rect.y0);
      const x1 = Number(rect.x1), y1 = Number(rect.y1);
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return;
      const cur = this._marqueeRect;
      const additive = !!rect.additive;
      if (cur && cur.x0 === x0 && cur.y0 === y0 && cur.x1 === x1 && cur.y1 === y1 && cur.additive === additive) return;
      this._marqueeRect = { x0, y0, x1, y1, additive, seedId: rect.seedId ?? null };
      this.needsRedraw = true;
    } catch {
      this._marqueeRect = null;
      this.needsRedraw = true;
    }
  }

  /**
   * Rectangle pick in CLIENT CSS px. Returns every NOTE whose bounding box INTERSECTS
   * the rect (containment is not required).
   *
   * Measures participate through their visible triangle handles.
   */
  pickRect(clientX0: number, clientY0: number, clientX1: number, clientY1: number) {
    return this.pickRectIds(clientX0, clientY0, clientX1, clientY1).map(id => ({ type: this._measureTriIdToIndex?.has(id) ? 'measure' : 'note', id }));
  }

  _worldRect(x0: number, y0: number, x1: number, y1: number) {
    const a = this.screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
    return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
  }

  _measureRectHits(x0: number, y0: number, x1: number, y1: number) {
    const hits: number[] = [];
    const css = this._measureTriCss;
    if (!css) return hits;
    const ox = this.canvasOffset?.x ?? 0, oy = this.canvasOffset?.y ?? 0;
    const left = Math.min(x0, x1) - ox, right = Math.max(x0, x1) - ox;
    const top = Math.min(y0, y1) - oy, bottom = Math.max(y0, y1) - oy;
    if (!this._measureTriIds?.length || bottom < css[1] || top > css[1] + css[3]) return hits;
    let first = 0;
    const count = this._measureTriIds.length;
    const ordered = !this._dragActive && !this._measurePreview && this.matrix?.[0] > 0;
    if (ordered) {
      let end = count;
      while (first < end) {
        const mid = Math.floor((first + end) / 2), o = mid * 4;
        if (css[o] + css[o + 2] < left) first = mid + 1;
        else end = mid;
      }
    }
    for (let i = first; i < count; i++) {
      const o = i * 4, x = css[o], y = css[o + 1], w = css[o + 2], h = css[o + 3];
      if (ordered && x > right) break;
      if (h <= 0 || bottom < y || top > y + h) continue;
      // The widest overlapping slice is at the lower edge of the intersection.
      const center = x + w / 2;
      const radius = w / 2 * Math.min(1, (bottom - y) / h);
      if (right >= center - radius && left <= center + radius) hits.push(this._measureTriIds[i]);
    }
    return hits;
  }

  pickRectIds(x0: number, y0: number, x1: number, y1: number) {
    const hits = this._measureRectHits(x0, y0, x1, y1);
    if (!this.posSize || !this._instanceNoteIds) return hits;
    const [left, minY, right, maxY] = this._worldRect(x0, y0, x1, y1);
    const ranges: number[] = [];
    if (this._rangeIndex) this._rangeIndex.collect(left, right, ranges, minY, maxY);
    else ranges.push(0, this.instanceCount);
    const ps = this.posSize;
    for (let j = 0; j < ranges.length; j += 2) {
      for (let i = ranges[j]; i < ranges[j + 1]; i++) {
        const o = i * 4, x = ps[o], y = ps[o + 1];
        if (x > right || x + ps[o + 2] < left || y > maxY || y + ps[o + 3] < minY) continue;
        const id = this._instanceNoteIds[i];
        if (id) hits.push(id);
      }
    }
    return hits;
  }

  // ============ Private helpers ============

  /**
   * Re-derive the multi-selection index caches from _multiSelIds.
   * MUST run after every rebuild of _noteIdToIndex / _measureTriIdToIndex: sync() mints
   * brand-new Maps and reorders instances, so a cached index silently starts pointing at a
   * DIFFERENT note. Ids are stable across syncs; indices are not.
   */
  _resolveMultiSelIndices() {
    const sel = this._multiSelIds;
    if (!sel || sel.size === 0) {
      this._multiSelNoteIdx = null;
      this._multiSelMeasureIds = null;
      this._multiSelNoteMapRef = this._noteIdToIndex || null;
      return;
    }
    const noteMap = this._noteIdToIndex || null;
    const noteIdx = [];
    const measureIds = [];
    for (const id of sel) {
      const i = noteMap?.get(id);
      if (i != null && i >= 0 && i < this.instanceCount) noteIdx.push(i);
      else measureIds.push(id);
    }
    this._multiSelMeasureIds = measureIds.length ? measureIds : null;
    this._multiSelNoteIdx = noteIdx.length ? noteIdx : null;
    this._multiSelNoteMapRef = noteMap;
  }

  _ensureMultiSelIndices() {
    if (!this._multiSelIds || this._multiSelIds.size === 0) return false;
    if (this._multiSelNoteMapRef !== (this._noteIdToIndex || null)) {
      this._resolveMultiSelIndices();
    }
    return true;
  }

  _multiSelRingRgba() {
    const c = this._selectionRingRgba();
    return [c[0], c[1], c[2], 1.0];
  }

  _multiSelRingPx() {
    return (this._config?.selection?.multiRingThicknessPxAtZoom1 ?? 4.0);
  }

  _setAttr4Enabled(flag: boolean) {
    try {
      const gl = this.gl;
      const vao = this.rectVAO;
      if (!gl || !vao) return;
      gl.bindVertexArray(vao);
      if (flag) gl.enableVertexAttribArray(4); else gl.disableVertexAttribArray(4);
      gl.bindVertexArray(null);
    } catch {}
  }

  // Enable/disable attrib 2 (dragFlag) on the octaveLineVAO (used by vertical lines)
  _setOctaveAttr2Enabled(flag: boolean) {
    try {
      const gl = this.gl;
      const vao = this.octaveLineVAO;
      if (!gl || !vao) return;
      gl.bindVertexArray(vao);
      if (flag) gl.enableVertexAttribArray(2); else gl.disableVertexAttribArray(2);
      gl.bindVertexArray(null);
    } catch {}
  }
 
  _resizeCanvasToDisplaySize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width  * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      if (this.gl) {
        this.gl.viewport(0, 0, w, h);
      }
      // Bump epoch on viewport size change so cached screen-space buffers can refresh
      this._viewEpoch = (this._viewEpoch || 0) + 1;
      this.needsRedraw = true;
    }
  }

  _initPrograms() {
    const gl = this.gl;

    // Rects (instanced)
    const rectVS = `#version 300 es
      precision highp float;

      // Base quad unit positions (0..1)
      layout(location=0) in vec2 a_unit;

      // Instance attributes
      layout(location=1) in vec4 a_posSize; // x,y,w,h in world
      layout(location=2) in vec4 a_color;

      uniform mat3 u_matrix; // world -> screen

      out vec4 v_color;

      void main() {
        // Transform unit quad to world
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;

        // Affine transform to screen
        vec3 screen = u_matrix * vec3(worldPos, 1.0);

        // Convert to NDC
        // Screen coords are in CSS pixels; canvas resolution is in device pixels.
        // We map screen (px) -> normalized device coords using viewport size uniforms.
        // For simplicity, we will derive NDC in fragment by using gl_Position here directly in pixel space
        // by mapping to [-1,1] using viewport size.
        // Injected via gl.viewport, so we must convert here:
        // We'll pass viewport size as uniform.
      }`;

    // We need viewport size uniforms; recompile VS with proper NDC mapping.
    const rectVS2 = `#version 300 es
      precision highp float;

      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA
      layout(location=6) in float a_dragFlag;  // 1.0 = apply drag offset, 0.0 = no offset

      uniform mat3 u_matrix;                   // world -> screen (page CSS px)
      uniform vec2 u_viewport;                 // (canvas CSS width, canvas CSS height)
      uniform vec2 u_offset;                   // canvas top-left in page CSS px
      uniform float u_layerBase;               // depth base
      uniform float u_layerStep;               // depth step per instance (negative brings closer)
      uniform int u_instanceBase;
      uniform vec2 u_dragOffset;               // (dx, dw) in world units for dragging

      out vec4 v_color;
      out vec2 v_css;                          // canvas-local CSS px

      void main() {
        // Apply drag offset only to flagged instances
        vec2 offset = a_dragFlag * u_dragOffset;
        vec2 posAdjusted = a_posSize.xy + vec2(offset.x, 0.0);
        vec2 sizeAdjusted = a_posSize.zw + vec2(offset.y, 0.0);
        
        vec2 worldPos = posAdjusted + a_unit * sizeAdjusted;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 local = screen.xy - u_offset;              // canvas-local CSS px
        // Convert to NDC
        float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0; // invert Y
        float ndcZ = u_layerBase + float(u_instanceBase + gl_InstanceID) * u_layerStep;
        gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
        v_color = a_color;
        v_css = local;
      }
    `;

    const rectFS = `#version 300 es
      precision highp float;
      in vec4 v_color;
      out vec4 outColor;
      void main() {
        outColor = v_color;
      }
    `;

    this.rectProgram = this._createProgram(rectVS2, rectFS);
    // Cache uniforms for rectProgram (generic solid rects)
    try {
      this._uniforms.rect = this._uniforms.rect || {};
      if (this.rectProgram && this.gl) {
        const gl = this.gl;
        const p = this.rectProgram;
        this._uniforms.rect.u_matrix   = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.rect.u_viewport = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.rect.u_offset   = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.rect.u_layerBase= gl.getUniformLocation(p, 'u_layerBase');
        this._uniforms.rect.u_layerStep= gl.getUniformLocation(p, 'u_layerStep');
        this._uniforms.rect.u_dragOffset= gl.getUniformLocation(p, 'u_dragOffset');
      }
    } catch {}

    // Playhead (drawn as a thin vertical rectangle in world coords)
    const playVS = rectVS2; // same vertex logic
    const playFS = `#version 300 es
      precision highp float;
      out vec4 outColor;
      void main() {
        // #ffa800 with glow-like opacity (approx)
        outColor = vec4(1.0, 0.66, 0.0, 1.0);
      }
    `;
    this.playheadProgram = this._createProgram(playVS, playFS);
    // Cache uniforms for playheadProgram
    try {
      this._uniforms.playhead = this._uniforms.playhead || {};
      if (this.playheadProgram && this.gl) {
        const gl = this.gl;
        const p = this.playheadProgram;
        this._uniforms.playhead.u_matrix   = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.playhead.u_viewport = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.playhead.u_offset   = gl.getUniformLocation(p, 'u_offset');
      }
    } catch {}

    // Measure bars dashed fragment shader (screen-space dash pattern along Y)
    const measureDashFS = `#version 300 es
      precision highp float;
      in vec2 v_css;                 // canvas-local CSS px
      uniform float u_dashLen;       // dash length in CSS px
      uniform float u_gapLen;        // gap length in CSS px
      uniform float u_alpha;         // overall alpha
      uniform vec3 u_color;          // themed measure-bar color (default white)
      out vec4 outColor;
      void main() {
        float period = max(1.0, u_dashLen + u_gapLen);
        float m = mod(max(v_css.y, 0.0), period);
        float a = m < u_dashLen ? 1.0 : 0.0;
        outColor = vec4(u_color, u_alpha * a);
      }
    `;
    this.measureDashProgram = this._createProgram(rectVS2, measureDashFS);
    // Cache uniforms for measureDashProgram
    try {
      this._uniforms.measureDash = this._uniforms.measureDash || {};
      if (this.measureDashProgram && this.gl) {
        const gl = this.gl;
        const p = this.measureDashProgram;
        this._uniforms.measureDash.u_matrix = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.measureDash.u_viewport = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.measureDash.u_offset = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.measureDash.u_dashLen = gl.getUniformLocation(p, 'u_dashLen');
        this._uniforms.measureDash.u_gapLen = gl.getUniformLocation(p, 'u_gapLen');
        this._uniforms.measureDash.u_alpha = gl.getUniformLocation(p, 'u_alpha');
        this._uniforms.measureDash.u_color = gl.getUniformLocation(p, 'u_color');
      }
    } catch {}

    // Simple rectangular program with border (no complex SDF)
    const rectBorderVS = `#version 300 es
      precision highp float;

      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA
      layout(location=3) in vec2 a_noteSize;   // (w,h) in CSS px (deprecated; kept for compatibility)
      layout(location=5) in float a_flags;     // 1.0 = silence, 0.0 = normal
      layout(location=6) in float a_dragFlag;  // 1.0 = apply drag offset, 0.0 = no offset
      layout(location=7) in float a_corruptionType; // 0=none, 1=transitive, 2=direct
      layout(location=8) in vec4 a_env;        // envelope (attack, decay, sustain, release); zeros = none

      uniform mat3 u_matrix;                   // world -> screen (page CSS px)
      uniform vec2 u_viewport;                 // (canvas CSS width, canvas CSS height)
      uniform vec2 u_offset;                   // canvas top-left in page CSS px
      uniform float u_layerBase;               // depth base
      uniform float u_layerStep;               // depth step per instance
      uniform int u_instanceBase;
      uniform vec2 u_scale;                    // (px per world unit X, px per world unit Y)
      uniform vec2 u_dragOffset;               // (dx, dw) in world units for dragging

      out vec4 v_color;
      out vec2 v_css;                          // canvas-local CSS px (this vertex)
      out vec2 v_uv;                           // local (0..1)
      out vec2 v_noteSize;                     // note size in CSS px
      out float v_isSilence;                   // flag propagated to FS
      out float v_corruptionType;              // corruption type for hatching
      out vec4 v_env;                          // envelope shape for the FS

      void main() {
        // Apply drag offset only to flagged instances
        vec2 offset = a_dragFlag * u_dragOffset;
        vec2 posAdjusted = a_posSize.xy + vec2(offset.x, 0.0);
        vec2 sizeAdjusted = a_posSize.zw + vec2(offset.y, 0.0);

        vec2 worldPos = posAdjusted + a_unit * sizeAdjusted;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 localCss = screen.xy - u_offset;           // canvas-local CSS px

        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        float ndcZ = u_layerBase + float(u_instanceBase + gl_InstanceID) * u_layerStep;
        gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
        v_color = a_color;
        v_css = localCss;
        v_uv = a_unit;
        // Derive CSS pixel size from world size and current scale; ignore a_noteSize
        v_noteSize = sizeAdjusted * u_scale;
        v_isSilence = a_flags;
        v_corruptionType = a_corruptionType;
        v_env = a_env;
      }
    `;
    const rectBorderFS = `#version 300 es
      precision highp float;

      in vec4 v_color;
      in vec2 v_uv;
      in vec2 v_noteSize;             // CSS px
      in float v_isSilence;           // 1.0 for silence -> suppress solid border
      in float v_corruptionType;      // 0=none, 1=transitive, 2=direct
      in vec4 v_env;                  // (attack, decay, sustain, release) shares; zeros = none

      uniform float u_cornerRadius;   // CSS px (scaled with zoom)
      uniform float u_borderWidth;    // CSS px (scaled with zoom)
      uniform vec4  u_borderColor;    // RGBA
      uniform float u_hatchSpacing;   // CSS px between diagonal lines
      uniform float u_hatchThickness; // CSS px line thickness
      uniform vec4  u_hatchColor;     // RGBA for hatching lines

      out vec4 outColor;

      // Loudness: a gain in dB, and the band height that shows it (full at 0 dB,
      // nothing at -48 dB). An exponential fall is a straight line on this scale.
      float toDb(float g) { return 8.685889638 * log(max(g, 1e-4)); }
      float dbHeight(float g) { return clamp(1.0 + toDb(g) / 48.0, 0.0, 1.0); }

      // Signed distance to rounded rectangle with half-size b and corner radius r.
      // Negative inside, positive outside, zero at the boundary.
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      // Compute diagonal hatch pattern at given angle (radians)
      // Returns 1.0 on line, 0.0 off line, with anti-aliasing
      float diagonalHatch(vec2 pos, float spacing, float thickness, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        vec2 rotated = vec2(pos.x * c - pos.y * s, pos.x * s + pos.y * c);
        float d = mod(rotated.x, spacing);
        float dist = min(d, spacing - d);
        float aa = fwidth(dist);
        float halfThick = thickness * 0.5;
        return 1.0 - smoothstep(halfThick - aa, halfThick + aa, dist);
      }

      void main() {
        // Local CSS px coordinates centered at note center
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r = min(u_cornerRadius, min(he.x, he.y)); // avoid degenerate radius
        float bw = max(u_borderWidth, 0.0);

        // Distance field: negative inside, positive outside
        float d = sdRoundRect(p, he, r);

        // Pixel-size dependent AA ramp
        float aa = max(fwidth(d), 1.0); // ~1px minimum

        // Coverage inside outer boundary (rounded rect with radius r)
        float aOuter = 1.0 - smoothstep(0.0, aa, d);

        // Coverage inside inner boundary offset by border width bw (rounded rect with radius r-bw)
        // Using d + bw shifts the isocontour inward by bw
        float aInnerShape = 1.0 - smoothstep(0.0, aa, d + bw);

        // Border ring = area between outer and inner coverages — suppress when silence
        float ring = clamp(aOuter - aInnerShape, 0.0, 1.0) * (1.0 - clamp(v_isSilence, 0.0, 1.0));

        // Interior = inner shape only
        float interior = clamp(aInnerShape, 0.0, 1.0);

        // Compute hatching pattern for corrupted notes
        // Use top-left anchored coordinates so pattern is stable during resize
        // (v_uv goes 0..1, multiply by noteSize for CSS px from top-left corner)
        vec2 hatchPos = v_uv * v_noteSize;
        float hatchMask = 0.0;
        if (v_corruptionType > 0.5 && u_hatchSpacing > 0.0) {
          // Single diagonal for transitive corruption (45 degrees = PI/4)
          float hatch1 = diagonalHatch(hatchPos, u_hatchSpacing, u_hatchThickness, 0.785398);
          if (v_corruptionType > 1.5) {
            // Crosshatch for direct corruption (add opposite diagonal -45 degrees)
            float hatch2 = diagonalHatch(hatchPos, u_hatchSpacing, u_hatchThickness, -0.785398);
            hatchMask = max(hatch1, hatch2);
          } else {
            hatchMask = hatch1;
          }
          // Mask hatch to interior only (respect rounded corners)
          hatchMask *= interior;
        }

        // Composite: apply hatch color over note color in interior
        vec3 hatchedRgb = mix(v_color.rgb, u_hatchColor.rgb, hatchMask * u_hatchColor.a);

        // Envelope: the gain the note sounds with, as a band about its centre line
        // (attack ramp, decay to the sustain level, hold, release ramp). Inside the
        // band the note has its full colour; outside it is dimmed. A note without
        // an attack or release of its own (or the BaseNote's) has v_env = 0 and
        // draws as before.
        float interiorAlpha = v_color.a;
        if (v_env.x > 0.0) {   // attack is never 0 when drawn (floor); a disabled attribute reads (0,0,0,1)
          float x = clamp(v_uv.x, 0.0, 1.0);
          float atk = max(v_env.x, 1e-5);
          float dec = v_env.y;
          float sus = v_env.z;
          float rel = max(v_env.w, 1e-5);
          // The curve that sounds, on the dB scale: a linear rise in gain, an
          // exponential decay (straight in dB) to the level held to the note's end.
          float level;
          if (x < atk) level = dbHeight(x / atk);
          else if (x < atk + dec) level = clamp(1.0 + mix(0.0, toDb(sus), (x - atk) / max(dec, 1e-5)) / 48.0, 0.0, 1.0);
          else if (x < 1.0 - rel) level = dbHeight(sus);
          else level = dbHeight(sus) * clamp((1.0 - x) / rel, 0.0, 1.0);
          float halfBand = level * he.y;
          float dy = abs(p.y) - halfBand;           // CSS px outside the band (negative inside)
          float band = 1.0 - smoothstep(-0.75, 0.75, dy);
          interiorAlpha = v_color.a * mix(0.3, 1.0, band);
        }

        // Composite color and alpha:
        // - Border draws with u_borderColor on the ring (if not silence)
        // - Interior draws with hatched note color
        vec3 rgb = u_borderColor.rgb * ring + hatchedRgb * interior;
        float a   = u_borderColor.a   * ring + interiorAlpha * interior;

        // Discard fragments with no coverage to avoid unnecessary blending
        if (a <= 0.0) discard;
        outColor = vec4(rgb, a);
      }
    `;
    this.rectBorderProgram = this._createProgram(rectBorderVS, rectBorderFS);

    // Tails (Phase I): the release that rings after a note's end, drawn past it as
    // the note's envelope band continuing to silence. Display only: nothing picks,
    // snaps or drags by it.
    const tailVS = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 a_unit;
      layout(location=1) in vec4 a_posSize;    // (x, y, w, h) world: from the note's end, as tall as the note
      layout(location=2) in vec4 a_color;
      layout(location=3) in vec2 a_level;      // (gain at the note-off as a share of the peak, world units it starts under the note)
      uniform mat3 u_matrix;
      uniform vec2 u_viewport;
      uniform vec2 u_offset;
      uniform vec2 u_scale;
      out vec4 v_color;
      out vec2 v_uv;
      out float v_heightCss;
      out float v_level;
      out float v_t;                           // 0 at the note's end, 1 at silence
      out float v_tailPx;                      // the tail's length, CSS px
      out float v_underPx;                     // how far it starts under the note, CSS px
      void main() {
        float under = a_level.y;
        vec2 worldPos = vec2(a_posSize.x - under, a_posSize.y) + a_unit * vec2(a_posSize.z + under, a_posSize.w);
        v_t = (a_unit.x * (a_posSize.z + under) - under) / a_posSize.z;
        vec2 l = (u_matrix * vec3(worldPos, 1.0)).xy - u_offset;
        gl_Position = vec4((l.x / u_viewport.x) * 2.0 - 1.0, 1.0 - (l.y / u_viewport.y) * 2.0, 0.0, 1.0);
        v_color = a_color;
        v_uv = a_unit;
        v_heightCss = a_posSize.w * u_scale.y;
        v_level = a_level.x;
        v_tailPx = a_posSize.z * u_scale.x;
        v_underPx = under * u_scale.x;
      }
    `;
    const tailFS = `#version 300 es
      precision highp float;
      in vec4 v_color;
      in vec2 v_uv;
      in float v_heightCss;
      in float v_level;
      in float v_t;
      in float v_tailPx;
      in float v_underPx;
      out vec4 outColor;
      void main() {
        // Under the note only its rounded corners' cut-outs are drawn: the note's
        // body (translucent) must not be tinted by the tail beneath it.
        float dxPx = v_t * v_tailPx;
        if (dxPx < 0.0) {
          float r = v_underPx, halfH = 0.5 * v_heightCss;
          vec2 q = vec2(dxPx + r, abs(v_uv.y - 0.5) * v_heightCss - (halfH - r));
          if (!(q.y > 0.0 && length(q) > r - 0.5)) discard;
        }
        // The release falls exponentially from the note-off level to -80 dB: a
        // straight line in dB, drawn on the body's scale (full at 0 dB, nothing at -48).
        float startDb = 8.685889638 * log(max(v_level, 1e-4));
        float db = mix(startDb, -80.0, clamp(v_t, 0.0, 1.0));   // level held under the note's corner
        float level = clamp(1.0 + db / 48.0, 0.0, 1.0);
        float dy = abs(v_uv.y - 0.5) * v_heightCss - level * 0.5 * v_heightCss;
        float band = 1.0 - smoothstep(-0.75, 0.75, dy);
        float a = v_color.a * 0.45 * band;
        if (a <= 0.004) discard;
        outColor = vec4(v_color.rgb, a);
      }
    `;
    this.tailProgram = this._createProgram(tailVS, tailFS);
    // Cache uniform locations for rectBorderProgram to avoid per-frame getUniformLocation calls
    try {
      if (!this._uniforms) this._uniforms = {};
      this._uniforms.rectBorder = this._uniforms.rectBorder || {};
      if (this.rectBorderProgram && this.gl) {
        const gl = this.gl;
        const prog = this.rectBorderProgram;
        this._uniforms.rectBorder.u_matrix       = gl.getUniformLocation(prog, 'u_matrix');
        this._uniforms.rectBorder.u_viewport     = gl.getUniformLocation(prog, 'u_viewport');
        this._uniforms.rectBorder.u_offset       = gl.getUniformLocation(prog, 'u_offset');
        this._uniforms.rectBorder.u_cornerRadius = gl.getUniformLocation(prog, 'u_cornerRadius');
        this._uniforms.rectBorder.u_borderWidth  = gl.getUniformLocation(prog, 'u_borderWidth');
        this._uniforms.rectBorder.u_borderColor  = gl.getUniformLocation(prog, 'u_borderColor');
        this._uniforms.rectBorder.u_layerBase    = gl.getUniformLocation(prog, 'u_layerBase');
        this._uniforms.rectBorder.u_layerStep    = gl.getUniformLocation(prog, 'u_layerStep');
        this._uniforms.rectBorder.u_scale        = gl.getUniformLocation(prog, 'u_scale');
        this._uniforms.rectBorder.u_dragOffset   = gl.getUniformLocation(prog, 'u_dragOffset');
        this._uniforms.rectBorder.u_hatchSpacing   = gl.getUniformLocation(prog, 'u_hatchSpacing');
        this._uniforms.rectBorder.u_hatchThickness = gl.getUniformLocation(prog, 'u_hatchThickness');
        this._uniforms.rectBorder.u_hatchColor     = gl.getUniformLocation(prog, 'u_hatchColor');
      }
    } catch {}

    // Border program for drawing just the border
    const borderOnlyVS = `#version 300 es
      precision highp float;
 
      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA
 
      uniform mat3 u_matrix;                   // world -> screen (page CSS px)
      uniform vec2 u_viewport;                 // (canvas CSS width, canvas CSS height)
      uniform vec2 u_offset;                   // canvas top-left in page CSS px
      uniform float u_borderWidth;             // border width in CSS px
      uniform vec2 u_scale;                    // (px per world X, px per world Y)
 
      out vec4 v_color;
      out vec2 v_css;                          // canvas-local CSS px (this vertex)
      out vec2 v_uv;                           // local (0..1)
      out vec2 v_noteSize;                     // note size in CSS px
      out float v_borderWidth;                 // border width in CSS px
 
      void main() {
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 localCss = screen.xy - u_offset;           // canvas-local CSS px
        
        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
        v_color = a_color;
        v_css = localCss;
        v_uv = a_unit;
        v_noteSize = a_posSize.zw * u_scale;
        v_borderWidth = u_borderWidth;
      }
    `;
    const borderOnlyFS = `#version 300 es
      precision highp float;
 
      in vec4 v_color;
      in vec2 v_uv;
      in vec2 v_noteSize;    // CSS px
      in float v_borderWidth; // CSS px
 
      uniform float u_cornerRadius;  // CSS px
 
      out vec4 outColor;
 
      // Signed distance to rounded rectangle with half-size b and corner radius r.
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
 
      void main() {
        // Local CSS px coordinates centered in the note
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r = min(u_cornerRadius, min(he.x, he.y)); // clamp to half-size for stability
 
        // Distance to outer rounded rectangle boundary (negative inside)
        float d = sdRoundRect(p, he, r);
 
        // Border ring: inside outer surface and outside inner offset by v_borderWidth (all in CSS px)
        if (d <= 0.0 && d >= -v_borderWidth) {
          outColor = vec4(0.388, 0.388, 0.388, 1.0); // #636363
        } else {
          discard;
        }
      }
    `;
    this.borderOnlyProgram = this._createProgram(borderOnlyVS, borderOnlyFS);

    // Selection ring (rounded rectangle outline) program
    const selRingVS = `#version 300 es
      precision highp float;

      layout(location=0) in vec2 a_unit;
      layout(location=1) in vec4 a_posSize; // (x,y,w,h) in world units

      uniform mat3 u_matrix;   // world -> screen (page CSS px)
      uniform vec2 u_viewport; // canvas CSS px
      uniform vec2 u_offset;   // canvas top-left CSS px
      uniform float u_layerZ;  // depth
      uniform vec2 u_scale;    // (px per world X, px per world Y)
      uniform vec2 u_dragOffset; // (dx, dw) in world units; 0,0 when not moving (or for anchor)
      uniform vec4 u_marqueeBounds; // min.xy, max.xy in world units
      uniform int u_marqueeFilter; // 1 draws hits, -1 draws only the existing group outside it

      out vec2 v_uv;
      out vec2 v_noteSize; // CSS px

      void main() {
        // Apply drag/resize offset (dx,dw) when provided
        if (u_marqueeFilter != 0) {
          bool intersects = all(lessThanEqual(a_posSize.xy, u_marqueeBounds.zw))
                         && all(greaterThanEqual(a_posSize.xy + a_posSize.zw, u_marqueeBounds.xy));
          if (intersects != (u_marqueeFilter > 0)) {
            gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
            return;
          }
        }
        vec2 posAdjusted  = a_posSize.xy + vec2(u_dragOffset.x, 0.0);
        vec2 sizeAdjusted = a_posSize.zw + vec2(u_dragOffset.y, 0.0);

        vec2 worldPos = posAdjusted + a_unit * sizeAdjusted;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);
        vec2 localCss = screen.xy - u_offset;

        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        gl_Position = vec4(ndcX, ndcY, u_layerZ, 1.0);
        v_uv = a_unit;
        v_noteSize = sizeAdjusted * u_scale;
      }
    `;
    const selRingFS = `#version 300 es
      precision highp float;

      in vec2 v_uv;
      in vec2 v_noteSize; // CSS px

      uniform float u_cornerRadius; // CSS px
      uniform float u_borderWidth;  // CSS px
      uniform vec4  u_color;        // RGBA

      out vec4 outColor;

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r = min(u_cornerRadius, min(he.x, he.y));
        float d = sdRoundRect(p, he, r);

        float aa = max(fwidth(d), 1.0);
        float aOuter = 1.0 - smoothstep(0.0, aa, d);
        float aInner = 1.0 - smoothstep(0.0, aa, d + u_borderWidth);
        float ring = clamp(aOuter - aInner, 0.0, 1.0);

        if (ring <= 0.0) discard;
        outColor = vec4(u_color.rgb, u_color.a * ring);
      }
    `;
    this.selectionRingProgram = this._createProgram(selRingVS, selRingFS);
    try {
      this._uniforms.selectionRing = this._uniforms.selectionRing || {};
      if (this.selectionRingProgram && this.gl) {
        const gl = this.gl;
        const p = this.selectionRingProgram;
        this._uniforms.selectionRing.u_matrix       = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.selectionRing.u_viewport     = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.selectionRing.u_offset       = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.selectionRing.u_layerZ       = gl.getUniformLocation(p, 'u_layerZ');
        this._uniforms.selectionRing.u_scale        = gl.getUniformLocation(p, 'u_scale');
        this._uniforms.selectionRing.u_cornerRadius = gl.getUniformLocation(p, 'u_cornerRadius');
        this._uniforms.selectionRing.u_borderWidth  = gl.getUniformLocation(p, 'u_borderWidth');
        this._uniforms.selectionRing.u_color        = gl.getUniformLocation(p, 'u_color');
        this._uniforms.selectionRing.u_dragOffset   = gl.getUniformLocation(p, 'u_dragOffset');
        this._uniforms.selectionRing.u_marqueeFilter = gl.getUniformLocation(p, 'u_marqueeFilter');
        this._uniforms.selectionRing.u_marqueeBounds = gl.getUniformLocation(p, 'u_marqueeBounds');
      }
    } catch {}

    // Selection fill (rounded interior) program
    const selFillVS = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 a_unit;
      layout(location=1) in vec4 a_posSize; // (x,y,w,h) in world units

      uniform mat3 u_matrix;   // world -> screen (page CSS px)
      uniform vec2 u_viewport; // canvas CSS px
      uniform vec2 u_offset;   // canvas top-left CSS px
      uniform float u_layerZ;  // depth
      uniform vec2 u_scale;    // (px per world X, px per world Y)
      uniform vec2 u_dragOffset; // (dx, dw) world units; pass 0,0 when not moving

      out vec2 v_uv;
      out vec2 v_noteSize; // CSS px

      void main() {
        vec2 posAdjusted  = a_posSize.xy + vec2(u_dragOffset.x, 0.0);
        vec2 sizeAdjusted = a_posSize.zw + vec2(u_dragOffset.y, 0.0);

        vec2 worldPos = posAdjusted + a_unit * sizeAdjusted;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);
        vec2 localCss = screen.xy - u_offset;
        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        gl_Position = vec4(ndcX, ndcY, u_layerZ, 1.0);
        v_uv = a_unit;
        v_noteSize = sizeAdjusted * u_scale;
      }
    `;
    const selFillFS = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      in vec2 v_noteSize; // CSS px

      uniform float u_cornerRadius; // CSS px
      uniform float u_inset;        // CSS px (inset from outer border)
      uniform vec4  u_color;        // RGBA

      out vec4 outColor;

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        // Inset the interior so we don't overlap the solid border ring
        float r = min(max(0.0, u_cornerRadius - u_inset), min(he.x, he.y));
        float d = sdRoundRect(p, max(he - vec2(u_inset), vec2(0.0)), r);

        float aa = max(fwidth(d), 1.0);
        float aInner = 1.0 - smoothstep(0.0, aa, d);

        if (aInner <= 0.0) discard;
        outColor = vec4(u_color.rgb, u_color.a * aInner);
      }
    `;
    this.selectionFillProgram = this._createProgram(selFillVS, selFillFS);
    try {
      this._uniforms.selectionFill = this._uniforms.selectionFill || {};
      if (this.selectionFillProgram && this.gl) {
        const gl = this.gl;
        const p = this.selectionFillProgram;
        this._uniforms.selectionFill.u_matrix       = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.selectionFill.u_viewport     = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.selectionFill.u_offset       = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.selectionFill.u_layerZ       = gl.getUniformLocation(p, 'u_layerZ');
        this._uniforms.selectionFill.u_scale        = gl.getUniformLocation(p, 'u_scale');
        this._uniforms.selectionFill.u_cornerRadius = gl.getUniformLocation(p, 'u_cornerRadius');
        this._uniforms.selectionFill.u_inset        = gl.getUniformLocation(p, 'u_inset');
        this._uniforms.selectionFill.u_color        = gl.getUniformLocation(p, 'u_color');
        this._uniforms.selectionFill.u_dragOffset   = gl.getUniformLocation(p, 'u_dragOffset');
      }
    } catch {}

    // Tab overlay program: clip to inner rounded-rect and restrict to right-side band
    const tabMaskVS = `#version 300 es
      precision highp float;

      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA (unused)
      layout(location=4) in vec4 a_tabRegion;  // (xLeftPx, xRightPx, yTopPx, yBottomPx) in note-local CSS px (centered coords)
      layout(location=6) in float a_dragFlag;  // 1.0 = apply drag offset, 0.0 = no offset

      uniform mat3 u_matrix;                   // world -> screen (page CSS px)
      uniform vec2 u_viewport;                 // (canvas CSS width, canvas CSS height)
      uniform vec2 u_offset;                   // canvas top-left in page CSS px
      uniform float u_layerBase;               // depth base
      uniform float u_layerStep;               // depth step per instance
      uniform int u_instanceBase;
      uniform vec2 u_scale;                    // (px per world X, px per world Y)
      uniform vec2 u_dragOffset;               // (dx, dw) in world units for dragging/resizing

      out vec2 v_uv;
      out vec2 v_noteSize;
      out vec4 v_tabRegion;

      void main() {
        // Apply drag/resize offset only to flagged instances
        vec2 offset = a_dragFlag * u_dragOffset;
        vec2 posAdjusted = a_posSize.xy + vec2(offset.x, 0.0);
        vec2 sizeAdjusted = a_posSize.zw + vec2(offset.y, 0.0);

        vec2 worldPos = posAdjusted + a_unit * sizeAdjusted;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 localCss = screen.xy - u_offset;           // canvas-local CSS px

        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        float ndcZ = u_layerBase + float(u_instanceBase + gl_InstanceID) * u_layerStep;
        gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
        v_uv = a_unit;
        v_noteSize = sizeAdjusted * u_scale;
        v_tabRegion = a_tabRegion;
      }
    `;
    const tabMaskFS = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      in vec2 v_noteSize;
      in vec4 v_tabRegion;

      uniform float u_cornerRadius;  // CSS px
      uniform float u_borderWidth;   // CSS px
      uniform vec4  u_color;         // RGBA
      uniform float u_clipBias;      // CSS px, optional inward expansion of inner clip (0.0 = none)

      out vec4 outColor;

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r = min(u_cornerRadius, min(he.x, he.y));
        float bw = max(u_borderWidth, 0.0);

        // Distance to outer rounded rectangle boundary (negative inside)
        float d = sdRoundRect(p, he, r);
        float aa = max(fwidth(d), 1.0);
        // Inner coverage (inside rounded-rect interior) with small adjustable bias
        float aInner = 1.0 - smoothstep(0.0, aa, d + bw - u_clipBias);

        // Restrict to band (note-local centered coords)
        if (p.x < v_tabRegion.x || p.x > v_tabRegion.y ||
            p.y < v_tabRegion.z || p.y > v_tabRegion.w) {
          discard;
        }

        float a = aInner;
        if (a <= 0.0) discard;
        outColor = vec4(u_color.rgb, u_color.a * a);
      }
    `;
    this.tabMaskProgram = this._createProgram(tabMaskVS, tabMaskFS);
    // Cache uniforms for tabMaskProgram
    try {
      this._uniforms.tabMask = this._uniforms.tabMask || {};
      if (this.tabMaskProgram && this.gl) {
        const gl = this.gl;
        const p = this.tabMaskProgram;
        this._uniforms.tabMask.u_matrix     = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.tabMask.u_viewport   = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.tabMask.u_offset     = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.tabMask.u_cornerRadius = gl.getUniformLocation(p, 'u_cornerRadius');
        this._uniforms.tabMask.u_borderWidth  = gl.getUniformLocation(p, 'u_borderWidth');
        this._uniforms.tabMask.u_color      = gl.getUniformLocation(p, 'u_color');
        this._uniforms.tabMask.u_clipBias   = gl.getUniformLocation(p, 'u_clipBias');
        this._uniforms.tabMask.u_layerBase  = gl.getUniformLocation(p, 'u_layerBase');
        this._uniforms.tabMask.u_layerStep  = gl.getUniformLocation(p, 'u_layerStep');
        this._uniforms.tabMask.u_scale      = gl.getUniformLocation(p, 'u_scale');
        this._uniforms.tabMask.u_dragOffset = gl.getUniformLocation(p, 'u_dragOffset');
      }
    } catch {}

    // Rounded dashed ring program (SDF-masked) for silence borders
    const ringDashVS = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA (unused)
      layout(location=5) in float a_flags;     // 1.0 = silence, 0.0 = normal
      layout(location=6) in float a_dragFlag;  // 1.0 = apply drag offset, 0.0 = no offset

      uniform mat3  u_matrix;                  // world -> screen (page CSS px)
      uniform vec2  u_viewport;                // (canvas CSS width, canvas CSS height)
      uniform vec2  u_offset;                  // canvas top-left in page CSS px
      uniform float u_layerBase;               // depth base
      uniform float u_layerStep;               // depth step per instance
      uniform int u_instanceBase;
      uniform vec2  u_scale;                   // (px per world X, px per world Y)
      uniform vec2  u_dragOffset;              // (dx, dw) in world units for dragging

      out vec2 v_uv;
      out vec2 v_noteSize;
      out float v_isSilence;

      void main() {
        // Apply drag offset only to flagged instances
        vec2 offset = a_dragFlag * u_dragOffset;
        vec2 posAdjusted = a_posSize.xy + vec2(offset.x, 0.0);
        vec2 sizeAdjusted = a_posSize.zw + vec2(offset.y, 0.0);

        vec2 worldPos = posAdjusted + a_unit * sizeAdjusted;
        vec3 screen   = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 localCss = screen.xy - u_offset;             // canvas-local CSS px

        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        float ndcZ = u_layerBase + float(u_instanceBase + gl_InstanceID) * u_layerStep;
        gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);

        v_uv = a_unit;
        v_noteSize = sizeAdjusted * u_scale;
        v_isSilence = a_flags;
      }
    `;

    const ringDashFS = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      in vec2 v_noteSize;                // CSS px
      in float v_isSilence;              // 1.0 = silence, 0.0 = normal
      uniform float u_cornerRadius;      // CSS px
      uniform float u_borderWidth;       // CSS px
      uniform vec4  u_color;             // RGBA for dashes
      uniform float u_dashLen;           // base dash length (zoom-invariant)
      uniform float u_gapLen;            // base gap length (zoom-invariant)
      uniform float u_scaleX;            // pixels-per-world-unit along X
      uniform float u_scaleY;            // pixels-per-world-unit along Y
      uniform float u_alignBias;         // CSS px inward (+) or outward (-) bias for ring alignment
      out vec4 outColor;

      // Signed distance to rounded rectangle with half-size b and corner radius r.
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        // Draw only for silence notes
        if (v_isSilence < 0.5) { discard; }

        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r  = min(u_cornerRadius, min(he.x, he.y));
        float bw = max(u_borderWidth, 0.0);

        // Rounded-rect distance and AA with alignment bias
        float d0 = sdRoundRect(p, he, r);
        float d  = d0 + u_alignBias;
        float aa = max(fwidth(d0), 1.0);
        float aOuter = 1.0 - smoothstep(0.0, aa, d);
        float aInner = 1.0 - smoothstep(0.0, aa, d + bw);
        float ring   = clamp(aOuter - aInner, 0.0, 1.0);

        // Single-seam, full-perimeter parameterization (CSS px)
        vec2 b = max(he - vec2(r), vec2(0.0));
        float lenTop = 2.0 * b.x;
        float lenRight = 2.0 * b.y;
        float qArc = 1.57079632679 * r;

        float baseTop    = 0.0;
        float baseTR     = baseTop + lenTop;
        float baseRight  = baseTR + qArc;
        float baseBR     = baseRight + lenRight;
        float baseBottom = baseBR + qArc;
        float baseBL     = baseBottom + lenTop;
        float baseLeft   = baseBL + qArc;
        float baseTL     = baseLeft + lenRight;
        float perim      = baseTL + qArc; // total perimeter

        // Region classification
        bool onTop    = (p.y <= -b.y) && (abs(p.x) <= b.x);
        bool onBottom = (p.y >=  b.y) && (abs(p.x) <= b.x);
        bool onLeft   = (p.x <= -b.x) && (abs(p.y) <= b.y);
        bool onRight  = (p.x >=  b.x) && (abs(p.y) <= b.y);
        bool cornerTR = (p.x >  b.x) && (p.y < -b.y);
        bool cornerBR = (p.x >  b.x) && (p.y >  b.y);
        bool cornerBL = (p.x < -b.x) && (p.y >  b.y);
        bool cornerTL = (p.x < -b.x) && (p.y < -b.y);

        float sP = 0.0;
        if (onTop) {
          sP = baseTop + (p.x + b.x);
        } else if (cornerTR) {
          vec2 v = p - vec2(b.x, -b.y);
          float ang = atan(abs(v.y), abs(v.x)); // 0..pi/2
          sP = baseTR + r * ang;
        } else if (onRight) {
          sP = baseRight + (p.y + b.y);
        } else if (cornerBR) {
          vec2 v = p - vec2(b.x, b.y);
          float ang = atan(abs(v.y), abs(v.x));
          sP = baseBR + r * ang;
        } else if (onBottom) {
          sP = baseBottom + (b.x - p.x);
        } else if (cornerBL) {
          vec2 v = p - vec2(-b.x, b.y);
          float ang = atan(abs(v.y), abs(v.x));
          sP = baseBL + r * ang;
        } else if (onLeft) {
          sP = baseLeft + (b.y - p.y);
        } else { // cornerTL
          vec2 v = p - vec2(-b.x, -b.y);
          float ang = atan(abs(v.y), abs(v.x));
          sP = baseTL + r * ang;
        }

        float period = max(1.0, u_dashLen + u_gapLen);
        float m = mod(sP, period);
        float aDash = m < u_dashLen ? 1.0 : 0.0;

        float a = ring * aDash;
        if (a <= 0.0) discard;
        outColor = vec4(u_color.rgb, u_color.a * a);
      }
    `;
    this.silenceDashRingProgram = this._createProgram(ringDashVS, ringDashFS);
    // Cache uniforms for silenceDashRingProgram
    try {
      this._uniforms.silenceRing = this._uniforms.silenceRing || {};
      if (this.silenceDashRingProgram && this.gl) {
        const gl = this.gl;
        const p = this.silenceDashRingProgram;
        this._uniforms.silenceRing.u_matrix      = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.silenceRing.u_viewport    = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.silenceRing.u_offset      = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.silenceRing.u_cornerRadius= gl.getUniformLocation(p, 'u_cornerRadius');
        this._uniforms.silenceRing.u_borderWidth = gl.getUniformLocation(p, 'u_borderWidth');
        this._uniforms.silenceRing.u_color       = gl.getUniformLocation(p, 'u_color');
        this._uniforms.silenceRing.u_dashLen     = gl.getUniformLocation(p, 'u_dashLen');
        this._uniforms.silenceRing.u_gapLen      = gl.getUniformLocation(p, 'u_gapLen');
        this._uniforms.silenceRing.u_layerBase   = gl.getUniformLocation(p, 'u_layerBase');
        this._uniforms.silenceRing.u_layerStep   = gl.getUniformLocation(p, 'u_layerStep');
        this._uniforms.silenceRing.u_scale       = gl.getUniformLocation(p, 'u_scale');
        this._uniforms.silenceRing.u_scaleX      = gl.getUniformLocation(p, 'u_scaleX');
        this._uniforms.silenceRing.u_scaleY      = gl.getUniformLocation(p, 'u_scaleY');
        this._uniforms.silenceRing.u_alignBias   = gl.getUniformLocation(p, 'u_alignBias');
        this._uniforms.silenceRing.u_dragOffset  = gl.getUniformLocation(p, 'u_dragOffset');
      }
    } catch {}

  }
 
  _initGeometry() {
    const gl = this.gl;
    if (!gl) return;

    // Base quad unit (0,0)-(1,1) using TRIANGLE_FAN with 4 vertices
    const unit = new Float32Array([
      0,0,
      1,0,
      1,1,
      0,1
    ]);

    // ========== Rects ==========
    this.rectVAO = gl.createVertexArray();
    gl.bindVertexArray(this.rectVAO);

    // Unit buffer (loc 0)
    this.rectUnitBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectUnitBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unit, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0); // per-vertex

    // Instance posSize (loc 1)
    this.rectInstancePosSizeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
    // allocate empty initially
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1); // per-instance

    // Instance color (loc 2)
    this.rectInstanceColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1); // per-instance

    // Removed rectInstanceSizeBuffer (note CSS size now derived in-shader via u_scale)

    // Instance tab region (loc 4) - [xLeft, xRight, yTop, yBottom] in note-local CSS px (centered coords)
    this.rectInstanceTabRegionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1); // per-instance

    // Secondary buffer for inner tab region to avoid per-frame reuploads
    this.rectInstanceTabInnerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

    // Dedicated buffers for the batched arrow background regions. The upper and lower
    // halves get ONE BUFFER EACH on purpose: they were previously drawn from a single
    // shared buffer that was re-uploaded between the two draws, so the buffer ended each
    // frame holding the LOWER regions. That was invisible only because the upload ran every
    // frame; the moment it was correctly skipped, the "upper" draw read the lower regions
    // and the top arrow band disappeared. Separate buffers make each draw correct
    // regardless of when uploads happen.
    this.rectInstanceArrowRegionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowRegionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

    this.rectInstanceArrowDownRegionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowDownRegionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

    // Dedicated buffer for batched fraction divider regions (note-local CSS px band)
    this.rectInstanceDividerRegionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDividerRegionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

    // Restore attribute 4 to point to the primary region buffer by default
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);


    // Instance flags (loc 5) - 1.0 = silence, 0.0 = normal
    this.rectInstanceFlagsBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceFlagsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 1, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(5, 1); // per-instance

    // Drag flags (loc 6) - 1.0 = apply drag offset, 0.0 = no offset
    this.rectInstanceDragFlagsBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDragFlagsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 1, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 1); // per-instance

    // Corruption type (loc 7) - 0.0 = none, 1.0 = transitive, 2.0 = direct
    this.rectInstanceCorruptionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceCorruptionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 1, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(7, 1); // per-instance

    // Envelope shape (loc 8) - (attack, decay, sustain level, release) as shares of
    // the note; all zeros = no envelope drawn
    this.rectInstanceEnvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceEnvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(8, 1); // per-instance

    // ========== Tails (Phase I) ==========
    // Their own VAO and instance buffers (filled by _syncTails), on the rects' unit quad.
    this.tailVAO = gl.createVertexArray();
    gl.bindVertexArray(this.tailVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectUnitBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tailPosSizeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tailPosSizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    this.tailColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tailColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    this.tailLevelBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tailLevelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 2 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(this.rectVAO); // back to the rects for the setup below

    // Dedicated buffer for single-instance draws (avoid corrupting shared per-instance buffer)
    this._singlePosSizeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
       
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // ========== Playhead ==========
    this.playheadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.playheadVAO);

    // Reuse unit quad
    const playUnitBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, playUnitBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unit, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    // Instance a_posSize (x,y,w,h) for playhead (single instance)
    this.playheadPosSizeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.playheadPosSizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(4), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    // Color (constant, we won't use varying)
    this.playheadColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.playheadColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 0.66, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /**
   * Draw the rounded-rect ring for an arbitrary list of NOTE instance indices in one
   * instanced call. Hoisted out of _render() so ring passes that are not tied to the
   * single selected note (dependency rings, multi-selection) can share it.
   */
  _drawRingIdxList(indices: number[] | null, rgba: number[], borderPx: number, marqueeBounds: number[] | null = null, cacheKey: string | null = null) {
    const gl = this.gl;
    if (!gl || !this.selectionRingProgram) return;
    if (!indices?.length && !marqueeBounds) return;
    if (!this.posSize || !this.instanceCount) return;

    const rectCss = this._cachedCanvasRect || (this.canvas ? this.canvas.getBoundingClientRect() : null);
    if (!rectCss) return;
    const vpW = Math.max(1, rectCss.width);
    const vpH = Math.max(1, rectCss.height);

    // Do not write depth to avoid z-fighting; place slightly behind selection ring
    gl.depthMask(false);
    gl.useProgram(this.selectionRingProgram);
    const Us = (this._uniforms && this._uniforms.selectionRing) ? this._uniforms.selectionRing : null;
    const uMat = Us ? Us.u_matrix       : gl.getUniformLocation(this.selectionRingProgram, 'u_matrix');
    const uVP  = Us ? Us.u_viewport     : gl.getUniformLocation(this.selectionRingProgram, 'u_viewport');
    const uOff = Us ? Us.u_offset       : gl.getUniformLocation(this.selectionRingProgram, 'u_offset');
    const uZ   = Us ? Us.u_layerZ       : gl.getUniformLocation(this.selectionRingProgram, 'u_layerZ');
    const uSC  = Us ? Us.u_scale        : gl.getUniformLocation(this.selectionRingProgram, 'u_scale');
    const uCR  = Us ? Us.u_cornerRadius : gl.getUniformLocation(this.selectionRingProgram, 'u_cornerRadius');
    const uBW  = Us ? Us.u_borderWidth  : gl.getUniformLocation(this.selectionRingProgram, 'u_borderWidth');
    const uCol = Us ? Us.u_color        : gl.getUniformLocation(this.selectionRingProgram, 'u_color');

    if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
    if (uVP)  gl.uniform2f(uVP, vpW, vpH);
    if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
    if (uZ)   gl.uniform1f(uZ, -0.000025);
    if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
    { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
    // Border thickness (CSS px at zoom=1) per call
    if (uBW)  gl.uniform1f(uBW, ((borderPx != null ? borderPx : 2.0)) * (this.xScalePxPerWU || 1.0));
    if (uCol) gl.uniform4f(uCol, rgba[0], rgba[1], rgba[2], rgba[3]);

    gl.bindVertexArray(this.rectVAO);
    if (marqueeBounds && Us) {
      gl.uniform4fv(Us.u_marqueeBounds, marqueeBounds);
      gl.uniform1i(Us.u_marqueeFilter, indices ? -1 : 1);
      if (!indices) {
        // The GPU already has every visible note's bounds. A moving marquee
        // needs just four coordinates until the user commits the selection.
        gl.uniform2f(Us.u_dragOffset, 0, 0);
        this._drawVisibleInstances(this.selectionRingProgram, null, this._visibleRanges);
        gl.uniform1i(Us.u_marqueeFilter, 0);
        gl.bindVertexArray(null);
        this._setAttr4Enabled(true);
        gl.depthMask(true);
        return;
      }
    }
    if (!indices) return;
    if (!this._singlePosSizeBuffer) {
      this._singlePosSizeBuffer = gl.createBuffer();
    }

    const uDrag = Us ? Us.u_dragOffset : gl.getUniformLocation(this.selectionRingProgram, 'u_dragOffset');
    // The ring shader reads only position/size and a uniform drag offset.
    // Draw consecutive rings with the same offset together, in painter order.
    // A committed selection has fixed world geometry. Keep each large ring
    // batch on the GPU across camera frames; drag previews retain their offsets.
    let saved = null;
    if (cacheKey && !this._dragActive && indices.length >= 512) {
      const buffers = this._ringBuffers || (this._ringBuffers = new Map<string, CachedRings>());
      saved = buffers.get(cacheKey);
      if (!saved) {
        saved = { buffer: gl.createBuffer() };
        buffers.set(cacheKey, saved);
      }
    }
    const upload = !saved || saved.indices !== indices || saved.epoch !== this._posEpoch;
    const need = indices.length * 4;
    if (!this._depRingBatch || this._depRingBatch.length < need) {
      this._depRingBatch = new Float32Array(Math.max(need, 64));
    }
    const batch = this._depRingBatch;
    let count = upload ? 0 : (saved?.count ?? 0), moving = false;
    const flush = () => {
      if (uDrag) gl.uniform2f(uDrag, moving ? this._dragOffsetX || 0 : 0, moving ? this._dragOffsetW || 0 : 0);
      if (upload) {
        gl.bufferData(gl.ARRAY_BUFFER, batch, gl.DYNAMIC_DRAW, 0, count * 4);
        if (saved) {
          saved.indices = indices;
          saved.epoch = this._posEpoch;
          saved.count = count;
        }
      }
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, count);
      count = 0;
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, saved?.buffer || this._singlePosSizeBuffer);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    if (upload) for (const idx of indices) {
      if (idx == null || idx < 0 || idx >= this.instanceCount) continue;
      const shifted = !!(this._dragActive && this._dragFlags?.[idx] === 1 &&
        !(this._dragAnchorIndex != null && idx === (this._dragAnchorIndex | 0)));
      if (count && shifted !== moving) flush();
      moving = shifted;
      const source = idx * 4, target = count * 4;
      batch[target] = this.posSize[source];
      batch[target + 1] = this.posSize[source + 1];
      batch[target + 2] = this.posSize[source + 2];
      batch[target + 3] = this.posSize[source + 3];
      count++;
    }
    if (count) flush();
    if (marqueeBounds && Us) gl.uniform1i(Us.u_marqueeFilter, 0);

    // Restore instanced buffer for attribute 1
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    // Re-enable attrib 4 for subsequent passes that need it
    this._setAttr4Enabled(true);
    gl.depthMask(true);
  }

  _selectionTrees(module: Module, anchor: number) {
    if (!module?.getChildrenTreeByAllProperties) return null;
    const cached = this._linkTreeCache;
    if (cached?.module === module && cached.anchor === anchor && cached.pos === this._posEpoch) return cached.trees;
    const trees = module.getChildrenTreeByAllProperties(anchor);
    this._linkTreeCache = { module, anchor, pos: this._posEpoch, trees };
    return trees;
  }

  _ensureGhostIndices() {
    if (!this._relRdepsIdx && this._lastSelectedNoteId != null && this._lastSelectedNoteId !== 0) {
      const ids = this._moduleRef?.getDependentNotes?.(this._lastSelectedNoteId) || [];
      this._relRdepsIdx = ids.map(id => this._noteIdToIndex.get(id)).filter(i => i != null);
    }
    return this._relRdepsIdx;
  }

  // Compute ranges once for all body and overlay passes of this frame.
  _updateVisibleInstances(vpW: number, vpH: number) {
    const ranges = this._nextVisibleRanges || [];
    const old = this._visibleRanges || [];
    const m = this.matrix;
    this._detailRanges = ranges;
    const aligned = m[1] === 0 && m[3] === 0 && m[0] > 0 && m[4] > 0;
    const x0 = (this.canvasOffset.x - m[6]) / m[0], x1 = x0 + vpW / m[0];
    const y0 = (this.canvasOffset.y - m[7]) / m[4], y1 = y0 + vpH / m[4];
    const dragPad = Math.abs(this._dragOffsetX || 0) + Math.abs(this._dragOffsetW || 0);
    if (!this._rangeIndex || !aligned) {
      ranges.length = 0;
      ranges.push(0, this.instanceCount);
    } else {
      const pad = 4 / m[0] + Math.max(Math.abs(x0), Math.abs(x1)) * 1e-6 + 2 * dragPad;
      this._rangeIndex.collect(x0 - pad, x1 + pad, ranges);
    }
    const cutoff = this._config.note.detailCutoff;
    if (aligned && (this.instanceCount > cutoff || this.instanceCount >= 512)) {
      this._detailRanges = this._viewportDetailRanges(ranges, x0, x1, y0, y1, dragPad, cutoff);
    }
    this._nextVisibleRanges = old;
    this._visibleRanges = ranges;
    const previous = this._lastDetailRanges;
    const next = this._detailRanges;
    if (!previous || next.length !== previous.length || next.some((v, i) => v !== previous[i])) {
      this._lastDetailRanges = next.slice();
      this._lastTabEpoch = this._lastArrowEpoch = -1;
      this._textDirty = true;
    }
  }

  // Count intersecting bodies in the actual viewport. Index leaf blocks may
  // contain offscreen notes, so their slot counts alone cannot decide the cutoff.
  _viewportDetailRanges(bodyRanges: number[], x0: number, x1: number, y0: number, y1: number, dragPad: number, cutoff: number) {
    let cache = this._overviewDetails;
    const sx = this.matrix[0], sy = this.matrix[4];
    if (!cache || cache.pos !== this._posEpoch || cache.drag !== this._dragEpoch ||
        cache.x0 !== x0 || cache.x1 !== x1 || cache.y0 !== y0 || cache.y1 !== y1 ||
        cache.sx !== sx || cache.sy !== sy || cache.cutoff !== cutoff) {
      const blocks = this._detailBlocks || (this._detailBlocks = []);
      if (this._rangeIndex) this._rangeIndex.collect(x0 - dragPad, x1 + dragPad, blocks, y0, y1);
      const candidates = this._rangeIndex ? blocks : bodyRanges;
      const ranges: number[] = [];
      let visible = 0;
      const p = this.posSize;
      if (!p) return [];
      for (let j = 0; j < candidates.length && visible <= cutoff; j += 2) {
        for (let i = candidates[j]; i < candidates[j + 1]; i++) {
          const o = i * 4;
          const shifted = this._dragActive && this._dragFlags?.[i];
          const x = p[o] + (shifted ? this._dragOffsetX : 0);
          const w = p[o + 2] + (shifted ? this._dragOffsetW : 0);
          const y = p[o + 1], h = p[o + 3];
          if (x >= x1 || x + w <= x0 || y >= y1 || y + h <= y0) continue;
          if (++visible > cutoff) break;
          if (ranges.length && ranges[ranges.length - 1] === i) ranges[ranges.length - 1]++;
          else ranges.push(i, i + 1);
        }
      }
      cache = this._overviewDetails = { x0, x1, y0, y1, sx, sy, cutoff,
        pos: this._posEpoch, drag: this._dragEpoch, ranges, crowded: visible > cutoff };
    }
    if (!cache.crowded) return cache.ranges;
    const selected = this._lastSelectedNoteId == null ? undefined : this._noteIdToIndex?.get(this._lastSelectedNoteId);
    const hovered = this._hoveredNoteId == null ? undefined : this._noteIdToIndex?.get(this._hoveredNoteId);
    const ranges: number[] = [];
    if (hovered != null && hovered !== selected) ranges.push(hovered, hovered + 1);
    if (selected != null) ranges.push(selected, selected + 1);
    return ranges;
  }

  _uploadChangedInstances(slots: number[]) {
    const gl = this.gl;
    if (!gl || !slots.length) return;
    const update = (buffer: WebGLBuffer | null, array: Float32Array<ArrayBuffer> | null, width: number) => {
      if (!array) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (let k = 0; k < slots.length;) {
        const first = slots[k++];
        let end = first + 1;
        while (k < slots.length && slots[k] === end) { end++; k++; }
        gl.bufferSubData(gl.ARRAY_BUFFER, first * width * 4, array, first * width, (end - first) * width);
      }
    };
    update(this.rectInstancePosSizeBuffer, this.posSize, 4);
    update(this.rectInstanceColorBuffer, this.colors, 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _uploadVisibleRegions(data: Float32Array<ArrayBuffer> | null) {
    const gl = this.gl;
    if (!gl || !data) return;
    for (let j = 0; j < this._detailRanges.length; j += 2) {
      const start = this._detailRanges[j], end = this._detailRanges[j + 1];
      if (end > start) gl.bufferSubData(gl.ARRAY_BUFFER, start * 16, data, start * 4, (end - start) * 4);
    }
  }

  _drawVisibleInstances(program: WebGLProgram, regionBuffer: WebGLBuffer | null = null, ranges: number[] = this._detailRanges) {
    const gl = this.gl;
    if (!gl) return;
    if (ranges.length === 2 && ranges[0] === 0 && ranges[1] === this.instanceCount) {
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.instanceCount);
      return;
    }
    if (!ranges.length) return;
    const uniforms = this._instanceBaseUniforms || (this._instanceBaseUniforms = new WeakMap<WebGLProgram, WebGLUniformLocation | null>());
    if (!uniforms.has(program)) uniforms.set(program, gl.getUniformLocation(program, 'u_instanceBase'));
    const base = uniforms.get(program) ?? null;
    const pointer = (loc: number, buffer: WebGLBuffer | null, size: number, first: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, first * size * 4);
    };
    const bind = (first: number) => {
      pointer(1, this.rectInstancePosSizeBuffer, 4, first);
      pointer(2, this.rectInstanceColorBuffer, 4, first);
      if (regionBuffer) pointer(4, regionBuffer, 4, first);
      pointer(5, this.rectInstanceFlagsBuffer, 1, first);
      pointer(6, this.rectInstanceDragFlagsBuffer, 1, first);
      pointer(7, this.rectInstanceCorruptionBuffer, 1, first);
      pointer(8, this.rectInstanceEnvBuffer, 4, first);
      gl.uniform1i(base, first);
    };
    for (let j = 0; j < ranges.length; j += 2) {
      const first = ranges[j];
      bind(first);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, ranges[j + 1] - first);
    }
    bind(0);
  }



  _render() {
    const gl = this.gl;
    const canvas = this.canvas;
    if (!gl || !canvas) return;

    if (!this.needsRedraw) return;
    this.needsRedraw = false;

    gl.enable(gl.BLEND);
    // Enable depth so overlays respect body stacking; bodies write depth, overlays test only
    gl.enable(gl.DEPTH_TEST);
    gl.clearDepth(1.0);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Prevent stale scissor from a previous frame from clipping the body pass
    gl.disable(gl.SCISSOR_TEST);

    // Use CSS pixel size for viewport uniform because Workspace basis gives CSS pixels
    // Use cached rect when available to avoid per-frame layout query
    const rectCss = this._cachedCanvasRect || canvas.getBoundingClientRect();
    const vpW = Math.max(1, rectCss.width);
    const vpH = Math.max(1, rectCss.height);
    
    // Update canvas offset for proper coordinate transformation
    this.canvasOffset = { x: rectCss.left, y: rectCss.top };
    

    this._updateVisibleInstances(vpW, vpH);

    // Tails first, under the note bodies: a note that follows paints over the tail
    // of the one before. Hidden while a drag previews new positions (they return
    // when it is committed and the notes are synced).
    if (this.tailCount > 0 && this.tailProgram && this.tailVAO && !this._dragActive) this._drawTails(vpW, vpH);

    // Draw notes as simple rectangles with flat colors (clipped to rounded rect)
    if (this.instanceCount > 0 && this.posSize) {
      // First pass: draw the note bodies (rounded clip)
      const prog = this.rectBorderProgram || this.rectProgram;
      if (!prog) return;
      gl.useProgram(prog);
      const U = (this._uniforms && this._uniforms.rectBorder) ? this._uniforms.rectBorder : null;
      const uMat = U ? U.u_matrix       : gl.getUniformLocation(prog, 'u_matrix');
      const uVP  = U ? U.u_viewport     : gl.getUniformLocation(prog, 'u_viewport');
      const uOff = U ? U.u_offset       : gl.getUniformLocation(prog, 'u_offset');
      const uCRb = U ? U.u_cornerRadius : gl.getUniformLocation(prog, 'u_cornerRadius');
      const uBWb = U ? U.u_borderWidth  : gl.getUniformLocation(prog, 'u_borderWidth');
      const uBCb = U ? U.u_borderColor  : gl.getUniformLocation(prog, 'u_borderColor');

      if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
      if (uVP)  gl.uniform2f(uVP, vpW, vpH);
      if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
      // Corner radius and border width scale with zoom (configurable; defaults preserve prior behavior)
     const zoomScaleBody = this.xScalePxPerWU || 1.0;
     const cornerPx = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0);
     const borderPx  = (this._config?.note?.borderPxAtZoom1 ?? 1.0);
     if (uCRb) gl.uniform1f(uCRb, cornerPx * zoomScaleBody);
     if (uBWb) gl.uniform1f(uBWb, borderPx * zoomScaleBody);
     { const nb = this._noteBorderRgba(); if (uBCb) gl.uniform4f(uBCb, nb[0], nb[1], nb[2], nb[3]); } // themed note border

      // Per-zoom CSS scale so shader derives note CSS size robustly (no per-frame size uploads)
      const uSC = U ? U.u_scale : gl.getUniformLocation(prog, 'u_scale');
      if (uSC) gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));

      // Depth layering: last instance (e.g., selected) is closest
      const uLB = U ? U.u_layerBase : gl.getUniformLocation(prog, 'u_layerBase');
      const uLS = U ? U.u_layerStep : gl.getUniformLocation(prog, 'u_layerStep');
      if (uLB) gl.uniform1f(uLB, 1.0);
      if (uLS) gl.uniform1f(uLS, -1.0 / Math.max(1, this.instanceCount + 5));

      // Drag offset uniform (world units)
      const uDrag = U ? U.u_dragOffset : gl.getUniformLocation(prog, 'u_dragOffset');
      if (uDrag) gl.uniform2f(uDrag, this._dragOffsetX || 0.0, this._dragOffsetW || 0.0);

      // Hatching uniforms for corruption visualization (scale with zoom like corner radius)
      const uHatchSpacing   = U ? U.u_hatchSpacing   : gl.getUniformLocation(prog, 'u_hatchSpacing');
      const uHatchThickness = U ? U.u_hatchThickness : gl.getUniformLocation(prog, 'u_hatchThickness');
      const uHatchColor     = U ? U.u_hatchColor     : gl.getUniformLocation(prog, 'u_hatchColor');
      const hatchSpacingBase = 5.0;  // base spacing at zoom=1 (2x denser)
      const hatchThicknessBase = 1.5; // base line width at zoom=1
      if (uHatchSpacing)   gl.uniform1f(uHatchSpacing, hatchSpacingBase * zoomScaleBody);
      if (uHatchThickness) gl.uniform1f(uHatchThickness, hatchThicknessBase * zoomScaleBody);
      if (uHatchColor)     gl.uniform4f(uHatchColor, 0.45, 0.28, 0.12, 0.85); // Brown, less transparent

      // Safety for ANGLE/D3D: disable unused instanced attrib 4 during ring-only passes
      this._setAttr4Enabled(false);
      gl.bindVertexArray(this.rectVAO);

      // Ensure buffers have latest - always upload when instance count > 0
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      // Using data uploaded during sync(); avoid per-frame bufferData to minimize driver stalls.
 
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceColorBuffer);
      // Using data uploaded during sync(); avoid per-frame bufferData to minimize driver stalls.

      // Note CSS size derived in-shader via u_scale (no per-frame size buffer)

      // Upload per-instance flags (silence mask) is handled during sync() to avoid per-frame uploads
 
      this._drawVisibleInstances(prog, null, this._visibleRanges);
      gl.bindVertexArray(null);

      // Second pass for borders is no longer needed because border is integrated
      // into the body shader with proper AA and zoom-consistent thickness.
      // (This block intentionally left inactive to preserve future flexibility.)
    }

    // Draw related dependency/dependent rings (thin outlines) below selection ring
    try {
      if (this.selectionRingProgram && this._lastSelectedNoteId !== 0) {
        // Property-colored dependency visualization
        // Colors follow the paradigm: which notes would MOVE if this property changes
        // Orange: frequency change would move these notes
        // Teal: startTime change would move these notes
        // Purple: duration change would move these notes
        //
        // During drag/resize: dim non-relevant properties to emphasize what's actually changing
        const isDragging = !!(this._dragActive && this._dragOverlay);
        const dragType = this._dragOverlay?.type || '';
        const isResize = dragType === 'resize';

        // Themed dependency-highlight colors (classic-orange tokens equal the old literals)
        const fqC = this._depFrequencyRgba();
        const stC = this._depStartTimeRgba();
        const duC = this._depDurationRgba();
        const withA = (c: number[], a: number) => [c[0], c[1], c[2], a];

        // Normal colors (full brightness)
        const HIGHLIGHT_COLORS_NORMAL = {
          frequency: { dep: withA(fqC, 0.9), rdep: withA(fqC, 0.4) },
          startTime: { dep: withA(stC, 0.9), rdep: withA(stC, 0.4) },
          duration:  { dep: withA(duC, 0.9), rdep: withA(duC, 0.4) }
        };

        // During drag (move): startTime full, others dimmed
        const HIGHLIGHT_COLORS_DRAG = {
          frequency: { dep: withA(fqC, 0.15), rdep: withA(fqC, 0.08) },
          startTime: { dep: withA(stC, 0.9), rdep: withA(stC, 0.4) },
          duration:  { dep: withA(duC, 0.15), rdep: withA(duC, 0.08) }
        };

        // During resize: duration full, others dimmed
        const HIGHLIGHT_COLORS_RESIZE = {
          frequency: { dep: withA(fqC, 0.15), rdep: withA(fqC, 0.08) },
          startTime: { dep: withA(stC, 0.15), rdep: withA(stC, 0.08) },
          duration:  { dep: withA(duC, 0.9), rdep: withA(duC, 0.4) }
        };

        const HIGHLIGHT_COLORS = isDragging
          ? (isResize ? HIGHLIGHT_COLORS_RESIZE : HIGHLIGHT_COLORS_DRAG)
          : HIGHLIGHT_COLORS_NORMAL;

        const DEP_THICKNESS = (this._config?.selection?.ringThicknessPxAtZoom1 ?? 2.0) * 1.5;
        const RDEP_THICKNESS = (this._config?.selection?.ringThicknessPxAtZoom1 ?? 2.0) * 1.0;

        // Draw property-colored rings for dependents (notes affected by property change)
        // Draw in order: startTime first (teal), then frequency (orange), then duration (purple)
        // This stacking order ensures all colors are visible for overlapping dependencies
        for (const prop of ['startTime', 'frequency', 'duration'] as const) {
          const rdepsIdx = this._relRdepsIdxByProperty?.[prop];
          if (rdepsIdx?.length) {
            this._drawRingIdxList(rdepsIdx, HIGHLIGHT_COLORS[prop].rdep, RDEP_THICKNESS, null, 'child:' + prop);
          }
        }

        // Draw property-colored rings for full parent chain (all ancestors back to baseNote)
        // Uses chain indices instead of direct deps to show the full dependency path
        for (const prop of ['startTime', 'frequency', 'duration'] as const) {
          const chainIdx = this._relDepsChainIdxByProperty?.[prop];
          if (chainIdx?.length) {
            this._drawRingIdxList(chainIdx, HIGHLIGHT_COLORS[prop].dep, DEP_THICKNESS, null, 'parent:' + prop);
          }
        }
      }
    } catch {}

    // Multi-selection group ring (notes) — above the dependency rings, below the single
    // selection ring, so the "current" note keeps its normal ring on top.
    try {
      const rect = this._marqueeRect;
      const bounds = rect && this._worldRect(rect.x0, rect.y0, rect.x1, rect.y1);
      if ((!rect || rect.additive) && this._ensureMultiSelIndices() && this._multiSelNoteIdx) {
        this._drawRingIdxList(this._multiSelNoteIdx, this._multiSelRingRgba(), this._multiSelRingPx(), bounds, 'group');
      }
      if (bounds) this._drawRingIdxList(null, this._multiSelRingRgba(), this._multiSelRingPx(), bounds);
    } catch {}

    // Selection outline for currently selected note (rounded, zoom-aware)
    try {
      if (this.selectionRingProgram && this._lastSelectedNoteId != null && this._noteIdToIndex && typeof this._noteIdToIndex.get === 'function') {
        const idx = this._noteIdToIndex.get(this._lastSelectedNoteId);
        if (idx != null && idx >= 0 && idx < this.instanceCount && this.posSize) {
          const base = idx * 4;
          const arr = new Float32Array([
            this.posSize[base + 0],
            this.posSize[base + 1],
            this.posSize[base + 2],
            this.posSize[base + 3]
          ]);

          // Ensure selection ring does not write to depth to avoid z-fighting or banding artifacts
          gl.depthMask(false);
          // Ensure selection visuals render at screen resolution and do not write depth
          gl.depthMask(false);

          // Optional rounded selection fill drawn first (behind ring)
          if (this.selectionFillProgram) {
            gl.useProgram(this.selectionFillProgram);
            const Uf = (this._uniforms && this._uniforms.selectionFill) ? this._uniforms.selectionFill : null;
            const uMatF = Uf ? Uf.u_matrix       : gl.getUniformLocation(this.selectionFillProgram, 'u_matrix');
            const uVPF  = Uf ? Uf.u_viewport     : gl.getUniformLocation(this.selectionFillProgram, 'u_viewport');
            const uOffF = Uf ? Uf.u_offset       : gl.getUniformLocation(this.selectionFillProgram, 'u_offset');
            const uZF   = Uf ? Uf.u_layerZ       : gl.getUniformLocation(this.selectionFillProgram, 'u_layerZ');
            const uSCF  = Uf ? Uf.u_scale        : gl.getUniformLocation(this.selectionFillProgram, 'u_scale');
            const uCRF  = Uf ? Uf.u_cornerRadius : gl.getUniformLocation(this.selectionFillProgram, 'u_cornerRadius');
            const uIN   = Uf ? Uf.u_inset        : gl.getUniformLocation(this.selectionFillProgram, 'u_inset');
            const uCF   = Uf ? Uf.u_color        : gl.getUniformLocation(this.selectionFillProgram, 'u_color');

            if (uMatF) gl.uniformMatrix3fv(uMatF, false, this.matrix);
            if (uVPF)  gl.uniform2f(uVPF, vpW, vpH);
            if (uOffF) gl.uniform2f(uOffF, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
            if (uZF)   gl.uniform1f(uZF, -0.00002);
            if (uSCF)  gl.uniform2f(uSCF, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
            { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCRF)  gl.uniform1f(uCRF, cr * (this.xScalePxPerWU || 1.0)); }
            // Inset ~1.5px at zoom=1 to keep a clean gap from the ring/border
            if (uIN)   gl.uniform1f(uIN, 1.5 * (this.xScalePxPerWU || 1.0));
            // Subtle highlight fill (premultiplied-friendly), themed selection color
            { const sr = this._selectionRingRgba(); if (uCF) gl.uniform4f(uCF, sr[0], sr[1], sr[2], 0.12); }

            // Disable unused attrib 4 for selection fill single-instance pass
            this._setAttr4Enabled(false);
            gl.bindVertexArray(this.rectVAO);
            if (!this._singlePosSizeBuffer) {
              this._singlePosSizeBuffer = gl.createBuffer();
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(1, 1);
            // Apply drag offset for selection fill if selected note is moving
            {
              const uDrag = Uf ? Uf.u_dragOffset : gl.getUniformLocation(this.selectionFillProgram, 'u_dragOffset');
              if (uDrag) {
                const isAnchor = (this._dragAnchorIndex != null) && (idx === (this._dragAnchorIndex | 0));
                const moving = !!(this._dragActive && this._dragFlags && this._dragFlags[idx] === 1.0 && !isAnchor);
                gl.uniform2f(uDrag, moving ? (this._dragOffsetX || 0.0) : 0.0, moving ? (this._dragOffsetW || 0.0) : 0.0);
              }
            }
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
          }

          // Now draw the selection ring on top
          gl.useProgram(this.selectionRingProgram);
          const Us = (this._uniforms && this._uniforms.selectionRing) ? this._uniforms.selectionRing : null;
          const uMat = Us ? Us.u_matrix       : gl.getUniformLocation(this.selectionRingProgram, 'u_matrix');
          const uVP  = Us ? Us.u_viewport     : gl.getUniformLocation(this.selectionRingProgram, 'u_viewport');
          const uOff = Us ? Us.u_offset       : gl.getUniformLocation(this.selectionRingProgram, 'u_offset');
          const uZ   = Us ? Us.u_layerZ       : gl.getUniformLocation(this.selectionRingProgram, 'u_layerZ');
          const uSC  = Us ? Us.u_scale        : gl.getUniformLocation(this.selectionRingProgram, 'u_scale');
          const uCR  = Us ? Us.u_cornerRadius : gl.getUniformLocation(this.selectionRingProgram, 'u_cornerRadius');
          const uBW  = Us ? Us.u_borderWidth  : gl.getUniformLocation(this.selectionRingProgram, 'u_borderWidth');
          const uCol = Us ? Us.u_color        : gl.getUniformLocation(this.selectionRingProgram, 'u_color');

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uZ)   gl.uniform1f(uZ, -0.00002);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
          if (uBW)  gl.uniform1f(uBW, (this._config?.selection?.ringThicknessPxAtZoom1 ?? 2.0) * (this.xScalePxPerWU || 1.0));
          { const sr = this._selectionRingRgba(); if (uCol) gl.uniform4f(uCol, sr[0], sr[1], sr[2], 1.0); }

          // Disable unused attrib 4 for selection ring pass
          this._setAttr4Enabled(false);
          gl.bindVertexArray(this.rectVAO);
          if (!this._singlePosSizeBuffer) {
            this._singlePosSizeBuffer = gl.createBuffer();
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          // Apply drag offset for selection ring if selected note is moving
          {
            const Usel = (this._uniforms && this._uniforms.selectionRing) ? this._uniforms.selectionRing : null;
            const uDrag = Usel ? Usel.u_dragOffset : gl.getUniformLocation(this.selectionRingProgram, 'u_dragOffset');
            if (uDrag) {
              const isAnchor = (this._dragAnchorIndex != null) && (idx === (this._dragAnchorIndex | 0));
              const moving = !!(this._dragActive && this._dragFlags && this._dragFlags[idx] === 1.0 && !isAnchor);
              gl.uniform2f(uDrag, moving ? (this._dragOffsetX || 0.0) : 0.0, moving ? (this._dragOffsetW || 0.0) : 0.0);
            }
          }
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

          // Restore instanced buffer for attribute 1
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          gl.bindVertexArray(null);
          // Re-enable attrib 4 for subsequent passes
          this._setAttr4Enabled(true);
          // Restore depth writes after drawing selection ring
          gl.depthMask(true);
        }
      }
    } catch {}

    // Hover outline (1px, themed hoverRing color) — drawn when a note is hovered and different from selected
    try {
      const hoverId = this._hoveredNoteId;
      if (this.selectionRingProgram && hoverId != null) {
        const sameAsSelected = (hoverId === this._lastSelectedNoteId);
        const idx = this._noteIdToIndex && this._noteIdToIndex.get ? this._noteIdToIndex.get(hoverId) : null;
        if (idx != null && idx >= 0 && idx < this.instanceCount && this.posSize) {
          const base = idx * 4;
          const arr = new Float32Array([
            this.posSize[base + 0],
            this.posSize[base + 1],
            this.posSize[base + 2],
            this.posSize[base + 3]
          ]);

          // Draw on top; do not write depth
          gl.depthMask(false);
          gl.useProgram(this.selectionRingProgram);
          const Us = (this._uniforms && this._uniforms.selectionRing) ? this._uniforms.selectionRing : null;
          const uMat = Us ? Us.u_matrix       : gl.getUniformLocation(this.selectionRingProgram, 'u_matrix');
          const uVP  = Us ? Us.u_viewport     : gl.getUniformLocation(this.selectionRingProgram, 'u_viewport');
          const uOff = Us ? Us.u_offset       : gl.getUniformLocation(this.selectionRingProgram, 'u_offset');
          const uZ   = Us ? Us.u_layerZ       : gl.getUniformLocation(this.selectionRingProgram, 'u_layerZ');
          const uSC  = Us ? Us.u_scale        : gl.getUniformLocation(this.selectionRingProgram, 'u_scale');
          const uCR  = Us ? Us.u_cornerRadius : gl.getUniformLocation(this.selectionRingProgram, 'u_cornerRadius');
          const uBW  = Us ? Us.u_borderWidth  : gl.getUniformLocation(this.selectionRingProgram, 'u_borderWidth');
          const uCol = Us ? Us.u_color        : gl.getUniformLocation(this.selectionRingProgram, 'u_color');

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uZ)   gl.uniform1f(uZ, -0.00002);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
          // Hover 1px vs selection 2px
          if (uBW)  gl.uniform1f(uBW, (this._config?.selection?.hoverThicknessPxAtZoom1 ?? 1.0) * (this.xScalePxPerWU || 1.0));
          // Slightly dim if same as selected to avoid double intensity (still visible)
          const a = sameAsSelected ? 0.6 : 1.0;
          { const hr = this._hoverRingRgba(); if (uCol) gl.uniform4f(uCol, hr[0], hr[1], hr[2], a); }

          // Disable unused attrib 4 for hover ring pass
          this._setAttr4Enabled(false);
          gl.bindVertexArray(this.rectVAO);
          if (!this._singlePosSizeBuffer) {
            this._singlePosSizeBuffer = gl.createBuffer();
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          // Apply drag offset for hover ring if hovered note is moving
          {
            const Uh = (this._uniforms && this._uniforms.selectionRing) ? this._uniforms.selectionRing : null;
            const uDrag = Uh ? Uh.u_dragOffset : gl.getUniformLocation(this.selectionRingProgram, 'u_dragOffset');
            if (uDrag) {
              const isAnchor = (this._dragAnchorIndex != null) && (idx === (this._dragAnchorIndex | 0));
              const moving = !!(this._dragActive && this._dragFlags && this._dragFlags[idx] === 1.0 && !isAnchor);
              gl.uniform2f(uDrag, moving ? (this._dragOffsetX || 0.0) : 0.0, moving ? (this._dragOffsetW || 0.0) : 0.0);
            }
          }
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

          // Restore instanced buffer for attribute 1
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          gl.bindVertexArray(null);

          // Re-enable attrib 4 for subsequent passes
          this._setAttr4Enabled(true);
          // Restore depth writes
          gl.depthMask(true);
        }
      }
    } catch {}

     // Draw playhead as a screen-space 1px line spanning full viewport height
    if (!this.solidCssProgram) return;
    gl.useProgram(this.solidCssProgram);
    const Us = (this._uniforms && this._uniforms.solidCss) ? this._uniforms.solidCss : null;
    const uVPs = Us ? Us.u_viewport : gl.getUniformLocation(this.solidCssProgram, 'u_viewport');
    const uCols = Us ? Us.u_color   : gl.getUniformLocation(this.solidCssProgram, 'u_color');
    const uZs   = Us ? Us.u_z       : gl.getUniformLocation(this.solidCssProgram, 'u_z');
    if (uVPs) gl.uniform2f(uVPs, vpW, vpH);
    {
      const c = (this._config?.playhead?.color ?? [1.0, 0.66, 0.0, 1.0]);
      if (uCols) gl.uniform4f(uCols, c[0], c[1], c[2], c[3]);
    }
    if (uZs) gl.uniform1f(uZs, -0.00002);

    // Ensure dragFlag attrib (2) is disabled for playhead draw
    this._setOctaveAttr2Enabled(false);

    // Compute playhead X in CSS px.
    // - Tracking mode: lock to viewport center to avoid any camera/scale ordering mismatch.
    // - Normal mode: derive from world time and currentXScaleFactor via affine.
    let localXPH = 0.0;
    if (this.trackingMode) {
      localXPH = vpW * 0.5;
    } else {
      const playXW = (this.playheadTimeSec || 0) * this._cfgSX() * (this.currentXScaleFactor || 1.0);
      const sxPH = this.matrix[0] * playXW + this.matrix[6];
      localXPH = (this.canvasOffset?.x != null) ? (sxPH - this.canvasOffset.x) : sxPH;
    }
    const leftPH = Math.round(localXPH) - 0.5; // crisp 1px centered on pixel grid

    gl.bindVertexArray(this.octaveLineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
    {
      const wPx = (this._config?.playhead?.thicknessPx ?? 1.0);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([leftPH, 0.0, wPx, vpH]), gl.DYNAMIC_DRAW);
    }
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
    gl.bindVertexArray(null);

    // Update trackers after draw (diagnostics)
    this._lastPlayheadLocalX = localXPH;
    this._lastPlayheadViewEpoch = this._viewEpoch;
    this._lastPlayheadScale = this.currentXScaleFactor;
  }


  _createProgram(vsSource: string, fsSource: string) {
    const gl = this.gl;
    if (!gl) return null;
    const vs = this._compile(gl.VERTEX_SHADER, vsSource);
    const fs = this._compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  _compile(type: number, source: string) {
    const gl = this.gl;
    if (!gl) return null;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(sh), '\nSource:\n', source);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  _frequencyToY(freq: number) {
    const base = (this._baseFreqCache && typeof this._baseFreqCache === 'number') ? this._baseFreqCache : 440;
    const logRatio = Math.log2(base / (freq || 1e-6));
    return logRatio * this._cfgSY() * this.currentYScaleFactor;
    // matches player.js frequencyToY semantics
  }

  _yForSilence(module: Module, note: Note, evaluatedNotes: EvaluatedScene | null) {
    // For silence notes (no frequency), follow player.js heuristic:
    // use parent with frequency if possible, otherwise baseNote.
    try {
      const parent = this._findParentWithFrequency(module, note);
      if (parent) {
        const fv = parent.getVariable('frequency');
        if (fv != null) return this._frequencyToY(toNumber(fv, 0));
      }
    } catch {}
    return this._frequencyToY(this._baseFreqCache);
  }

  _findParentWithFrequency(module: Module, note: Note): Note {
    if (!note) return module.baseNote;

    const startTimeString = note.variables?.startTimeString;
    let parentId = null;
    if (startTimeString) {
      const dm = /\[(\d+)\]\./.exec(startTimeString);
      if (dm) parentId = parseInt(dm[1], 10);
    }
    if (parentId == null && note.parentId != null) parentId = note.parentId;
    if (parentId == null) return module.baseNote;

    const parent = module.getNoteById(parentId);
    if (!parent) return module.baseNote;
    if (parent.getVariable && parent.getVariable('frequency')) return parent;
    return this._findParentWithFrequency(module, parent);
  }

  _resolveColor(evNote: RenderRecord | null | undefined, note: Note, module: Module) {
    // Try evaluated color first
    let c = evNote?.color;
    if (c != null) {
      const rgba = this._parseAnyColor(c);
      if (rgba) return this._applyCorruptionTint(rgba, note, module);
    }
    // Raw color source. Read the backing store directly rather than going through
    // note.variables: that getter returns a Proxy, and trapping one property access per
    // note per sync cost ~32ms at 100k notes. Note's own proxy handler resolves 'color' to
    // exactly this field, so the value is identical.
    const raw = note?.properties?.color;
    if (raw) {
      const col = (typeof raw === 'function') ? raw() : raw;
      const rgba = this._parseAnyColor(col);
      if (rgba) return this._applyCorruptionTint(rgba, note, module);
    }
    // Deterministic fallback from note id (hsla)
    const id = Number(note?.id ?? 0);
    let rgba = this._idColorCache && this._idColorCache.get(id);
    if (!rgba) {
      const hue = (id * 137.508) % 360;
      rgba = this._hslaToRgba(hue, 70, 60, 0.7);
      if (!this._idColorCache) this._idColorCache = new Map();
      this._idColorCache.set(id, rgba);
    }
    return this._applyCorruptionTint(rgba, note, module);
  }

  /**
   * Apply corruption tint to a color when note contains irrational values (TET scales)
   * NOTE: Color tinting has been replaced by diagonal hatching in the shader.
   * This method now simply returns the color unchanged.
   * Corruption visualization is handled via:
   * - Direct corruption (POW ops): Crosshatch pattern (X)
   * - Transitive corruption: Single diagonal hatch
   * @param {Array<number>} rgba - [r, g, b, a] color values in 0-1 range
   * @param {Object} note - The note object (unused, kept for API compatibility)
   * @param {Object} module - The module (unused, kept for API compatibility)
   * @returns {Array<number>} - Original rgba color unchanged
   */
  _applyCorruptionTint(rgba: number[], note: Note, module: Module) {
    // Corruption visualization is now handled by diagonal hatching in the shader
    // See rectBorderFS fragment shader for the hatching implementation
    return rgba;
  }

  /**
   * Convert HSL to RGBA (h in 0-360, s,l in 0-100)
   */
  _hslToRgba(h: number, s: number, l: number, a: number) {
    return this._hslaToRgba(h, s, l, a);
  }

  _parseAnyColor(col: unknown) {
    if (!col) return null;

    // Memoised by source string. Colours are immutable strings on the notes, so re-parsing
    // them (regex + hsl->rgb) on every sync was ~24ms at 100k notes for a result that never
    // changes. Callers treat the returned array as read-only (it is copied straight into the
    // instance colour buffer), so handing back a shared array is safe.
    if (typeof col === 'string') {
      let cache = this._parsedColorCache;
      if (!cache) cache = this._parsedColorCache = new Map();
      const hit = cache.get(col);
      if (hit !== undefined) return hit;
      const parsed = this._parseAnyColorUncached(col);
      // Distinct colours are bounded by the note count, so this cannot grow without limit for
      // a given module; the cache is dropped wholesale when the module changes (see sync).
      // Do NOT evict on a small cap: a module where every note has its own colour would then
      // overflow and clear on every single sync, re-parsing all of them each time.
      cache.set(col, parsed);
      return parsed;
    }
    return this._parseAnyColorUncached(col);
  }

  // Any CSS colour a note can be given (src/utils/css-color.js). It used to read only
  // rgba(), hsl()/hsla() and 3- or 6-digit hex, so rgb(255,255,255) or a colour name
  // fell through to the id-derived colour: a different hue on every note.
  _parseAnyColorUncached(col: unknown) {
    return parseCssColor(col);
  }

  _hslaToRgba(h: number, s: number, l: number, a: number) {
    // h in [0,360], s,l in [0,100]
    h = (h % 360 + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;

    const c = (1 - Math.abs(2*l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs(hp % 2 - 1));
    let r=0,g=0,b=0;
    if (0 <= hp && hp < 1) { r = c; g = x; b = 0; }
    else if (1 <= hp && hp < 2) { r = x; g = c; b = 0; }
    else if (2 <= hp && hp < 3) { r = 0; g = c; b = x; }
    else if (3 <= hp && hp < 4) { r = 0; g = x; b = c; }
    else if (4 <= hp && hp < 5) { r = x; g = 0; b = c; }
    else if (5 <= hp && hp < 6) { r = c; g = 0; b = x; }

    const m = l - c/2;
    return [ r + m, g + m, b + m, (a!=null?a:1) ];
  }

  // Convert page CSS pixel coordinates to world coordinates using inverse affine
  screenToWorld(clientX: number, clientY: number) {
    try {
      const offX = this.canvasOffset?.x || 0;
      const offY = this.canvasOffset?.y || 0;
      // Page CSS px -> canvas-local CSS px -> screen px for matrix (page-based already)
      const sx = clientX;
      const sy = clientY;

      // Inverse of 2x2 + translation
      const a = this.matrix[0], b = this.matrix[1];
      const c = this.matrix[3], d = this.matrix[4];
      const e = this.matrix[6], f = this.matrix[7];
      const det = a * d - b * c;
      if (!det || Math.abs(det) < 1e-12) return { x: 0, y: 0 };

      const invA =  d / det;
      const invB = -b / det;
      const invC = -c / det;
      const invD =  a / det;
      const invE = (c * f - d * e) / det;
      const invF = (b * e - a * f) / det;

      const wx = invA * sx + invC * sy + invE;
      const wy = invB * sx + invD * sy + invF;
      return { x: wx, y: wy };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  // Rounded-rect hit test util used for CPU picking to avoid corner hits
  // Behavior:
  //  - Exact inside test uses the same SDF as the shaders (outside <= 0).
  //  - Optional expandCssPx tolerance applies ONLY along straight edges, not in corner arcs,
  //    to prevent selecting when clicking near the visual rounded corners.
  _isPointInsideRoundedNote(i: number, wx: number, wy: number, expandCssPx: number = 0) {
    try {
      if (!this.posSize) return false;
    const o = i * 4;
      const x = this.posSize[o + 0];
      const y = this.posSize[o + 1];
      const w = this.posSize[o + 2];
      const h = this.posSize[o + 3];

      const sx = this.xScalePxPerWU || 1.0;
      const sy = this.yScalePxPerWU || 1.0;

      const wCss = w * sx;
      const hCss = h * sy;

      // Center of note in world units
      const cxW = x + w * 0.5;
      const cyW = y + h * 0.5;

      // Pointer offset in note-local CSS px, centered
      const dxCss = (wx - cxW) * sx;
      const dyCss = (wy - cyW) * sy;

      const heX = 0.5 * wCss;
      const heY = 0.5 * hCss;

      // Match body shader corner radius (CSS px)
      let r = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0) * (this.xScalePxPerWU || 1.0);
      r = Math.max(0, Math.min(r, Math.min(heX, heY)));

      // SDF for rounded-rect (CSS px space)
      const qx = Math.abs(dxCss) - (heX - r);
      const qy = Math.abs(dyCss) - (heY - r);
      const qxCl = Math.max(qx, 0.0);
      const qyCl = Math.max(qy, 0.0);
      const outside = Math.hypot(qxCl, qyCl) + Math.min(Math.max(qx, qy), 0.0) - r;

      // Strict inside matches visual shape exactly
      if (outside <= 0.0) return true;

      // Allow small tolerance ONLY along straight edges (not corners)
      const ex = Math.max(0, expandCssPx || 0);
      // "Corner zone" when both axes exceed the inner straight-edge extents
      const inCornerZone = (Math.abs(dxCss) > (heX - r)) && (Math.abs(dyCss) > (heY - r));

      if (ex > 0 && !inCornerZone) {
        return outside <= ex;
      }
      return false;
    } catch {
      // Fail-open to avoid missing hits if anything goes wrong
      return true;
    }
  }

  // CPU picking against rounded-rect geometry. Returns top-most note id or null.
  pickAt(clientX: number, clientY: number, expandCssPx: number = 2) {
    return this._pickNotes(clientX, clientY, expandCssPx, null);
  }

  // Stack and top-only queries share the same exact shape test and painter order.
  pickStackAt(clientX: number, clientY: number, expandCssPx: number = 2) {
    const hits: SceneHit[] = [];
    this._pickNotes(clientX, clientY, expandCssPx, hits);
    return hits;
  }

  _pickNotes(clientX: number, clientY: number, expandCssPx: number, hits: SceneHit[] | null) {
    if (!this.posSize || !this._instanceNoteIds) return null;
    const p = this.screenToWorld(clientX, clientY);
    const ex = expandCssPx / (this.xScalePxPerWU || 1);
    const ey = expandCssPx / (this.yScalePxPerWU || 1);
    const left = p.x - ex, right = p.x + ex, top = p.y - ey, bottom = p.y + ey;
    const ranges = this._pickRanges ||= [];
    if (this._rangeIndex && !this._dragActive) {
      this._rangeIndex.collect(left, right, ranges, top, bottom);
    } else {
      ranges.length = 2;
      ranges[0] = 0;
      ranges[1] = this._instanceNoteIds.length;
    }
    const rects = this.posSize;
    for (let r = ranges.length - 2; r >= 0; r -= 2) {
      for (let i = ranges[r + 1] - 1; i >= ranges[r]; i--) {
        const o = i * 4;
        if (rects[o] > right || rects[o] + rects[o + 2] < left ||
            rects[o + 1] > bottom || rects[o + 1] + rects[o + 3] < top) continue;
        if (!this._isPointInsideRoundedNote(i, p.x, p.y, expandCssPx)) continue;
        const hit: SceneHit = { type: 'note', id: this._instanceNoteIds[i] };
        if (!hits) return hit;
        hits.push(hit);
      }
    }
    return null;
  }
  /**
   * Hit test sub-region for the top-most note under the given client point.
   * Returns { id, region } where region ∈ {'body','tab','octaveUp','octaveDown'}, or null if no note.
   * - Uses the same geometry heuristics as overlay rendering for tab and octave arrow columns.
   * - Respects rounded-rect interior via pickAt() (corner-safe); only runs when a note body is hit.
   * - Silence notes do not report octaveUp/Down regions.
   */
  hitTestSubRegion(clientX: number, clientY: number, hit: SceneHit | null = this.pickAt(clientX, clientY, 2)) {
    try {
      if (!hit || hit.type !== 'note') return null;
      const id = hit.id | 0;

      // Resolve instance index
      const idx = (this._noteIdToIndex && typeof this._noteIdToIndex.get === 'function')
        ? this._noteIdToIndex.get(id)
        : undefined;
      if (idx == null || idx < 0 || idx >= this.instanceCount || !this.posSize) {
        return { id, region: 'body' };
      }

      // Only rendered controls can receive a gesture. In dense overviews most
      // note bodies have no tabs or arrows, even within the normal edge tolerance.
      const details = this._detailRanges;
      if (!this.drawNoteOverlays || (details && details !== this._visibleRanges &&
          !details.some((first, j) => j % 2 === 0 && first <= idx && idx < details[j + 1]))) {
        return { id, region: 'body' };
      }

      // Fetch per-instance world rect
      const o = idx * 4;
      const x = this.posSize[o + 0];
      const y = this.posSize[o + 1];
      const w = this.posSize[o + 2];
      const h = this.posSize[o + 3];

      // Current CSS px scales
      const sx = this.xScalePxPerWU || 1.0;
      const sy = this.yScalePxPerWU || 1.0;

      const wCss = w * sx;
      const hCss = h * sy;

      // Note center in world units
      const cxW = x + w * 0.5;
      const cyW = y + h * 0.5;

      // Convert client (page CSS px) -> world, then to note-local centered CSS px
      const p = this.screenToWorld(clientX, clientY);
      const dxCss = (p.x - cxW) * sx;
      const dyCss = (p.y - cyW) * sy;

      // Half extents in CSS px
      const heX = 0.5 * Math.max(0, wCss);
      const heY = 0.5 * Math.max(0, hCss);

      // Border thickness in CSS px (exact, matches shader)
      const borderCssExact = 1.0 * (this.xScalePxPerWU || 1.0);

      // Determine silence status (no octave arrows for silence)
      const isSilence = !!(this._instanceFlags && this._instanceFlags[idx] === 1.0);

      // 1) Right pull-tab strip region (full-height band along the inner-right side)
      // Match overlay sizing: ~0.5 * note height minus one border px, min 10px.
      {
        const borderCssInt = Math.max(1, Math.round(borderCssExact));
        const tabWidth = Math.max(10, Math.round(hCss * (this._config?.overlays?.tabWidthFactor ?? 0.5)) - borderCssInt);
        const rightInner = heX - borderCssInt;
        const tabLeft = rightInner - tabWidth;
        const inTabX = dxCss >= tabLeft && dxCss <= rightInner;
        // Y is unrestricted here; overall rounded-rect inclusion was already validated by pickAt()
        if (inTabX) {
          return { id, region: 'tab' };
        }
      }

      // 2) Left octave arrow column regions (upper/lower halves)
      // Gated on drawNoteArrows so disabling arrows also removes their click
      // zones (otherwise invisible octaveUp/Down hits would remain).
      if (!isSilence && this.drawNoteArrows) {
        // Match overlay sizing and slight overreach to avoid seam on the left
        const leftInner = -heX + borderCssExact;
        const targetBgWidth = Math.max(10, Math.round(hCss * (this._config?.overlays?.arrowColumnWidthFactor ?? 0.5) - borderCssExact));
        const bgWidth = Math.max(4, targetBgWidth);
        const xLeft = leftInner - 0.75;      // small overreach as in draw path
        const xRight = leftInner + bgWidth;

        if (dxCss >= xLeft && dxCss <= xRight) {
          const eps = 0.5; // small dead-zone around the midline
          if (dyCss < -eps) {
            return { id, region: 'octaveUp' };
          } else if (dyCss > eps) {
            return { id, region: 'octaveDown' };
          }
          // In dead-zone near center line, treat as body to avoid accidental arrow hits
        }
      }

      // 3) Otherwise, it's the body region
      return { id, region: 'body' };
    } catch {
      return null;
    }
  }
  // Event-driven preview: update a single instance via bufferSubData without full sync
  // DEPRECATED: Use setDragOffsetPreview for better performance with many notes
  setTempOverridesPreview(noteId: number | null, startSec: number, durationSec: number) {
    try {
      if (!this.gl || !this.rectInstancePosSizeBuffer || !this.posSize) return false;
      const idNum = Number(noteId);
      const idx = (this._noteIdToIndex && typeof this._noteIdToIndex.get === 'function')
        ? this._noteIdToIndex.get(idNum)
        : undefined;
      if (idx == null || idx < 0) return false;
 
      const base = idx * 4;
      // Compute world X/W from seconds using current scale factors (match sync semantics)
      const xw = Math.max(0, Number(startSec) || 0) * this._cfgSX() * (this.currentXScaleFactor || 1.0);
      const ww = Math.max(0.0001, Number(durationSec) || 0) * this._cfgSX() * (this.currentXScaleFactor || 1.0);
      const y  = this.posSize[base + 1];
      const h  = this.posSize[base + 3];
 
      // Update CPU-side cache
      this._hasPreviewGeometry = true;
      this._rangeIndex = null; // direct geometry preview; rebuilt on sync
      this.posSize[base + 0] = xw;
      this.posSize[base + 2] = ww;
 
      // Upload only this instance slice to GPU
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      const slice = new Float32Array([xw, y, ww, h]);
      // 4 floats per instance * 4 bytes per float
      gl.bufferSubData(gl.ARRAY_BUFFER, base * 4, slice);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
 
      this._posEpoch = (this._posEpoch || 0) + 1;
      this.needsRedraw = true;
      return true;
    } catch {
      return false;
    }
  }
 
  clearTempOverridesPreview(noteId: number | null) {
    // No GPU state to revert; a subsequent full sync will provide final values.
    // Just mark for redraw to ensure latest playhead/overlay state is shown.
    this.needsRedraw = true;
  }

  // Event-driven preview for a set of instances at once without full sync.
  // DEPRECATED: Use setDragOffsetPreview for vastly better performance with many notes.
  // Optimized fallback: batch all updates and upload the entire posSize buffer once to avoid
  // thousands of tiny bufferSubData calls (major driver overhead on large N).
  // map: { [noteId:number]: { startSec:number, durationSec:number } }
  setTempOverridesPreviewMap(map: Record<number, Preview> | null) {
    try {
      if (!this.gl || !this.rectInstancePosSizeBuffer || !this.posSize || !map) return false;
      const entries = Object.entries(map);
      if (!entries.length) return false;

      const xScale = this.currentXScaleFactor || 1.0;

      // Update CPU-side cache in-place for all affected instances
      for (const [idStr, ov] of entries) {
        const id = Number(idStr);
        const idx = (this._noteIdToIndex && this._noteIdToIndex.get) ? this._noteIdToIndex.get(id) : undefined;
        if (idx == null || idx < 0) continue;

        const base = idx * 4;

        const startSec = (ov && typeof ov.startSec === 'number')
          ? Math.max(0, ov.startSec)
          : (this.posSize[base + 0] / (this._cfgSX() * xScale));

        const durationSec = (ov && typeof ov.durationSec === 'number')
          ? Math.max(0.0001, ov.durationSec)
          : (this.posSize[base + 2] / (this._cfgSX() * xScale));

        const xw = startSec * this._cfgSX() * xScale;
        const ww = durationSec * this._cfgSX() * xScale;

        this._hasPreviewGeometry = true;
        this._rangeIndex = null;
        // Write back only x and w; y/h remain unchanged
        this.posSize[base + 0] = xw;
        this.posSize[base + 2] = ww;
      }

      // Single batched upload of the full instance buffer
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.posSize, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this._posEpoch = (this._posEpoch || 0) + 1;
      this.needsRedraw = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * High-performance drag preview using shader-based offsets.
   * Instead of updating thousands of buffer entries, this sets a uniform offset
   * and marks which instances should be shifted via a flags buffer.
   * The flags buffer is only re-uploaded when the affected set of instances changes.
   *
   * @param {Object} params - Drag parameters
   * @param {number} params.dxWorld - X offset in world units (for move)
   * @param {number} params.dwWorld - Width delta in world units (for resize)
   * @param {Set<number>|Array<number>} params.noteIds - IDs of notes to offset
   * @param {number|null} [params.anchorId] - Optional anchor note id (the one being dragged).
   *                                          Used to update CPU posSize only for the anchor so selection ring tracks.
   */
  setDragOffsetPreview({ dxWorld = 0, dwWorld = 0, noteIds = [], anchorId = null }: DragOffset) {
    try {
      if (!this.gl || !this._dragFlags) {
        console.warn('[PERF] setDragOffsetPreview: missing gl or dragFlags');
        return false;
      }

      // Update uniform offsets (no buffer upload needed)
      this._dragOffsetX = Number(dxWorld) || 0.0;
      this._dragOffsetW = Number(dwWorld) || 0.0;
      this._dragActive = true;

      // Also store seconds-based deltas for unified end-bar computation
      try {
        const denomSec = this._cfgSX() * (this.currentXScaleFactor || 1.0);
        this._dragDxSec = (this._dragOffsetX || 0.0) / denomSec;
        this._dragDdSec = (this._dragOffsetW || 0.0) / denomSec;
      } catch {
        this._dragDxSec = 0.0;
        this._dragDdSec = 0.0;
      }

      // Build and normalize the instance-index list for the currently moving set
      const idsSet = (noteIds instanceof Set) ? noteIds : new Set(noteIds);

      // The moving set is FIXED for the whole drag, but the callers hand us a freshly built Set
      // on every pointermove. Rebuilding _dragMovingIds and the sorted index list from it each
      // time meant two Sets plus an array of `size` entries plus an O(n log n) sort PER MOVE.
      // With a few thousand dependents that is megabytes of garbage per second, and it is the
      // periodic mid-drag GC hitch: it scales with the dependent count and fires once enough
      // has been allocated — i.e. "after moving some distance".
      // Recognise the unchanged set and reuse everything already computed.
      // Identity against the set WE were handed, tracked separately from _dragMovingIds:
      // setDragOverlay also writes _dragMovingIds, with different membership (it excludes the
      // anchor), so comparing against that would silently reuse the wrong set.
      const sameSet = (noteIds === this._dragPreviewIdsRef) && !!this._dragSetIndices;
      this._dragPreviewIdsRef = noteIds;

      let changedSet = false;
      if (!sameSet) {
        // Persist moving ids (numeric) so glyph-atlas drag flags apply immediately, even before overlay is enabled.
        try {
          const moving = new Set<number>();
          for (const id of idsSet) moving.add(Number(id));
          this._dragMovingIds = moving;
        } catch { this._dragMovingIds = null; }

        const idxArr = [];
        if (this._noteIdToIndex && typeof this._noteIdToIndex.get === 'function') {
          for (const id of idsSet) {
            const idx = this._noteIdToIndex.get(Number(id));
            if (idx != null && idx >= 0 && idx < (this.instanceCount || 0)) {
              idxArr.push(idx | 0);
            }
          }
        }
        idxArr.sort((a, b) => a - b);

        // Compare with previous flagged set; if unchanged, skip rebuilding/uploading flags buffer
        const prev = this._dragSetIndices;
        if (!prev || prev.length !== idxArr.length) {
          changedSet = true;
        } else {
          for (let i = 0; i < idxArr.length; i++) {
            if (prev[i] !== idxArr[i]) { changedSet = true; break; }
          }
        }
        this._pendingDragIdxArr = idxArr;
      }

      if (changedSet) {
        // changedSet can only be true on a rebuild, so the freshly built index list is here.
        const idxArr = this._pendingDragIdxArr || [];
        // Compute end-preview baselines once per moving-set change
        try {
          // Cache moving indices for fast scans
          this._baselineMovingIdx = Int32Array.from(idxArr);
          this._lastDragXScale = (this.currentXScaleFactor || 1.0);

          // Mark moving indices for exclusion
          const Ninst = Math.max(0, this.instanceCount | 0);
          const movingMask = new Array(Ninst).fill(false);
          for (let i = 0; i < idxArr.length; i++) {
            const ii = idxArr[i] | 0;
            if (ii >= 0 && ii < Ninst) movingMask[ii] = true;
          }

          // Compute baseline max end over non-moving notes once at drag start
          let baseNonMoving = 0;
          const denom = this._cfgSX() * (this.currentXScaleFactor || 1.0);
          for (let i = 0; i < Ninst; i++) {
            if (movingMask[i]) continue;
            const o = i * 4;
            const endSec = ((this.posSize![o + 0] || 0) + (this.posSize![o + 2] || 0)) / denom;
            if (isFinite(endSec)) baseNonMoving = Math.max(baseNonMoving, endSec);
          }
          this._baselineNonMovingEndSec = baseNonMoving;
        } catch {
          this._baselineNonMovingEndSec = null;
          this._baselineMovingIdx = null;
        }

        // Rebuild flags only when set changed
        this._dragFlags.fill(0.0);
        for (let i = 0; i < idxArr.length; i++) {
          const idx = idxArr[i];
          if (idx >= 0 && idx < this._dragFlags.length) this._dragFlags[idx] = 1.0;
        }
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDragFlagsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._dragFlags, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        // Cache signature
        this._dragSetIndices = Int32Array.from(idxArr);
        this._dragSetSize = idxArr.length | 0;
      }

      // CPU posSize cache update for selection ring/hover visuals:
      // Only update the anchor note (if provided or falls back to current selection).
      let anchorIdx = -1;
      if (anchorId != null) {
        anchorIdx = this._noteIdToIndex?.get?.(Number(anchorId)) ?? -1;
      }
      this._dragAnchorIndex = (anchorIdx | 0);

      // Only bake CPU pos/size for the anchor when it is actually in the moving set.
      // Membership in the set we were HANDED (idsSet) — the index list is derived from exactly
      // that, so this is equivalent to the old idxArr.indexOf(anchorIdx) scan but O(1).
      // Deliberately not _dragMovingIds: setDragOverlay overwrites that with a set that omits
      // the anchor, which would make the anchor stop tracking the cursor.
      const anchorIsMoving = (anchorIdx >= 0) && anchorId != null && idsSet.has(Number(anchorId));
      if (anchorIsMoving) {
        const base = anchorIdx * 4;
        if (this.posSize && (base + 3) < this.posSize.length) {
          if (!this._dragOriginalPos) this._dragOriginalPos = new Map();
          if (!this._dragOriginalPos.has(anchorIdx)) {
            this._dragOriginalPos.set(anchorIdx, {
              x: this.posSize[base + 0],
              w: this.posSize[base + 2]
            });
          }
          const orig = this._dragOriginalPos.get(anchorIdx);
          // Apply the live preview offsets to CPU cache only for the anchor note that is moving
          this.posSize[base + 0] = (orig?.x ?? this.posSize[base + 0]) + this._dragOffsetX;
          this.posSize[base + 2] = (orig?.w ?? this.posSize[base + 2]) + this._dragOffsetW;

          // Anchor's rectangle should NOT receive shader offset since posSize already has it baked in.
          // Set dragFlag to 0 and upload the anchor's posSize to GPU.
          if (this._dragFlags && anchorIdx < this._dragFlags.length && this._dragFlags[anchorIdx] !== 0.0) {
            this._dragFlags[anchorIdx] = 0.0;
            const gl = this.gl;
            if (gl && this.rectInstanceDragFlagsBuffer) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDragFlagsBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this._dragFlags, gl.DYNAMIC_DRAW);
              gl.bindBuffer(gl.ARRAY_BUFFER, null);
            }
          }
          // Upload anchor's posSize slice to GPU so rectangle matches text
          const gl = this.gl;
          if (gl && this.rectInstancePosSizeBuffer) {
            const slice = new Float32Array([
              this.posSize[base + 0],
              this.posSize[base + 1],
              this.posSize[base + 2],
              this.posSize[base + 3]
            ]);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, base * 4, slice);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
          }
        }
      }

       // Resize semantics for dependents: move by end delta, do not resize
            {
              const isResizePreview = !!(this._dragActive && Math.abs(this._dragOffsetW || 0.0) > 1e-9);
              if (isResizePreview && anchorIdx != null && anchorIdx >= 0) {
                // Shift dependents by the right-edge delta; no width delta via shader
                const shift = this._dragOffsetW || 0.0;
                this._dragOffsetX = shift;
                this._dragOffsetW = 0.0;
      
                // Ensure anchor does not receive shader offset; it was baked into CPU posSize above.
                try {
                  if (this._dragFlags && this._dragFlags.length > anchorIdx) {
                    if (this._dragFlags[anchorIdx] !== 0.0) this._dragFlags[anchorIdx] = 0.0;
                    const gl = this.gl;
                    if (gl && this.rectInstanceDragFlagsBuffer) {
                      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDragFlagsBuffer);
                      gl.bufferData(gl.ARRAY_BUFFER, this._dragFlags, gl.DYNAMIC_DRAW);
                      gl.bindBuffer(gl.ARRAY_BUFFER, null);
                    }
                  }
                } catch {}
      
                // Upload anchor's updated posSize slice so body width change is visible without shader dw.
                try {
                  const gl = this.gl;
                  if (gl && this.rectInstancePosSizeBuffer && this.posSize) {
                    const base = (anchorIdx | 0) * 4;
                    const slice = new Float32Array([
                      this.posSize[base + 0],
                      this.posSize[base + 1],
                      this.posSize[base + 2],
                      this.posSize[base + 3]
                    ]);
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, base * 4, slice);
                    gl.bindBuffer(gl.ARRAY_BUFFER, null);
                  }
                } catch {}
      
                // Mark last-step as resize so we can restore anchor slice when dw returns to 0
                this._dragLastWasResize = true;
              } else if (this._dragLastWasResize && anchorIdx != null && anchorIdx >= 0) {
                // Transition back to non-resize during an active drag:
                // push anchor's current CPU pos/size to GPU to restore original width.
                try {
                  const gl = this.gl;
                  if (gl && this.rectInstancePosSizeBuffer && this.posSize) {
                    const base = (anchorIdx | 0) * 4;
                    const slice = new Float32Array([
                      this.posSize[base + 0],
                      this.posSize[base + 1],
                      this.posSize[base + 2],
                      this.posSize[base + 3]
                    ]);
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, base * 4, slice);
                    gl.bindBuffer(gl.ARRAY_BUFFER, null);
                  }
                } catch {}
                this._dragLastWasResize = false;
              }
            }

      // IMPORTANT: Do NOT bump _posEpoch during drag preview.
      // Link-line endpoints rebuilds are expensive with thousands of dependents.
      // We keep overlays in sync via shader uniforms and minimal CPU updates.
      //
      // The anchor is the exception: its posSize was just rewritten above, so its glyph runs
      // and its dependency-line endpoints ARE stale and must be rebuilt. _dragEpoch is that
      // signal — narrow enough to leave the moving notes on the cheap shader path, but enough
      // that what the user is actually dragging tracks the cursor.
      this._dragEpoch = (this._dragEpoch || 0) + 1;
      this.needsRedraw = true;
      return true;
    } catch (err) {
      console.error('[PERF] setDragOffsetPreview error:', err);
      return false;
    }
  }

  /**
   * Clear drag offset preview and reset all drag flags.
   */
  clearDragOffsetPreview() {
    try {
      this._dragOffsetX = 0.0;
      this._dragOffsetW = 0.0;
      this._dragActive = false;
      // Clear moving set used by glyph-atlas drag flags
      this._dragMovingIds = null;
      // Drop the identity fast-path state so the next gesture always rebuilds.
      this._dragPreviewIdsRef = null;
      this._dragSetIndices = null;
      this._pendingDragIdxArr = null;

      // Ending the drag restores the anchor's original posSize below, so the glyph runs,
      // link-line endpoints and note-local regions are all stale again and must rebuild.
      this._dragEpoch = (this._dragEpoch || 0) + 1;

      // Restore original positions in CPU cache (only those we touched)
      if (this._dragOriginalPos && this.posSize) {
        for (const [idx, orig] of this._dragOriginalPos.entries()) {
          const base = idx * 4;
          if (base + 3 < this.posSize.length) {
            this.posSize[base + 0] = orig.x;
            this.posSize[base + 2] = orig.w;
            // A cancelled drag also restores the anchor on the next GPU sync.
            if (this._instanceNoteIds) (this._restoredDragIds ||= new Set()).add(this._instanceNoteIds[idx]);
          }
        }
        this._dragOriginalPos = null;
      }

      if (this._dragFlags) {
        this._dragFlags.fill(0.0);

        // Upload cleared flags
        const gl = this.gl;
        if (gl && this.rectInstanceDragFlagsBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDragFlagsBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this._dragFlags, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
        }
      }

      // Reset flags upload/caching state
      this._dragFlagsInited = false;
      this._dragFlagsLastCount = 0;
      this._dragSetIndices = null;
      this._dragSetSize = 0;
      this._dragAnchorIndex = -1;

      // Reset end-bar preview baselines/deltas
      this._baselineNonMovingEndSec = null;
      this._baselineMovingIdx = null;
      this._dragDxSec = 0.0;
      this._dragDdSec = 0.0;
      this._lastDragXScale = null;

      // After drag ends, bump position epoch once so any CPU-derived overlays (e.g., link lines)
      // can rebuild from authoritative positions.
      this._posEpoch = (this._posEpoch || 0) + 1;

      this.needsRedraw = true;
    } catch {}
  }

  // Clear any multi-note preview overrides; a subsequent sync restores true values.
  clearTempOverridesPreviewAll() {
    // Mark for redraw; next sync will repopulate buffers from authoritative state
    this.needsRedraw = true;
  }

  // Live preview for measure triangles/bars/end bar positions.
  // map: { [measureId:number]: startSec:number }
  setMeasurePreviewMap(map: Record<number, number> | null) {
    try {
      // Normalize numeric map
      const next: Record<string, number> = {};
      if (map && typeof map === 'object') {
        for (const k in map) {
          const v = map[k];
          if (typeof v === 'number' && isFinite(v)) {
            next[Number(k)] = Number(v);
          }
        }
      }
      // Detect delta to avoid unnecessary bumps
      let changed = true;
      try {
        const prev = this._measurePreview || null;
        const pk = prev ? Object.keys(prev).length : 0;
        const nk = Object.keys(next).length;
        if (pk === nk) {
          changed = false;
          for (const id in next) {
            if (!prev || prev[Number(id)] !== next[id]) { changed = true; break; }
          }
        }
      } catch { changed = true; }

      this._measurePreview = next;
      if (changed) {
        this._triPreviewEpoch = (this._triPreviewEpoch || 0) + 1;
        // Force dashed/solids recompute too
        this._lastMeasureEpoch = -1;
        this.needsRedraw = true;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Clear any active measure preview overrides
  clearMeasurePreview() {
    try {
      if (this._measurePreview && Object.keys(this._measurePreview).length) {
        this._measurePreview = null;
        this._triPreviewEpoch = (this._triPreviewEpoch || 0) + 1;
        this._lastMeasureEpoch = -1;
        this.needsRedraw = true;
      }
    } catch {
      this._measurePreview = null;
      this._triPreviewEpoch = (this._triPreviewEpoch || 0) + 1;
      this._lastMeasureEpoch = -1;
      this.needsRedraw = true;
    }
  }

  // Preview override for module end bar (seconds). When set, end bar will render at max(current end, preview end).
  setModuleEndPreviewSec(sec: number) {
    try {
      const v = Number(sec);
      if (isFinite(v) && v >= 0) {
        this._endTimePreviewSec = v;
      } else {
        this._endTimePreviewSec = null;
      }
      this.needsRedraw = true;
    } catch {
      this._endTimePreviewSec = null;
      this.needsRedraw = true;
    }
  }

  // Clear module end preview override.
  clearModuleEndPreview() {
    try {
      if (this._endTimePreviewSec != null) {
        this._endTimePreviewSec = null;
        this.needsRedraw = true;
      }
    } catch {
      this._endTimePreviewSec = null;
      this.needsRedraw = true;
    }
  }
}
 /* Augment RendererAdapter with measure bar rendering
   - Draws origin, all measure start bars, and final module end bar as thin vertical lines
   - Uses the same instanced-quad pipeline as notes (rectProgram) with per-instance colors
   - Constant pixel thickness via converting 1px to world units using xScalePxPerWU
   - Keeps pointer-events: none and does not change existing interactions
*/
(() => {
  try {
    if (typeof RendererAdapter === 'undefined') return;
    const proto = RendererAdapter.prototype;

    proto._initMeasurePass = function () {
      const gl = this.gl;
      if (!gl) return;

      // ========== Dashed measure bars (all interior measure points) ==========
      this.measureVAO = gl.createVertexArray();
      gl.bindVertexArray(this.measureVAO);

      const unit = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
      this._measureUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._measureUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, unit, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.measurePosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measurePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      this.measureColorBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.measureCount = 0;
      this.measurePosSize = null;
      this.measureColors = null;

      // ========== Solid start/end primary + secondary bars ==========
      this.measureSolidVAO = gl.createVertexArray();
      gl.bindVertexArray(this.measureSolidVAO);

      this._measureSolidUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._measureSolidUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, unit, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.measureSolidPosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      this.measureSolidColorBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.measureSolidCount = 0;
      this.measureSolidPosSize = null;
      this.measureSolidColors = null;

      // ========== Measure bar triangles (screen-space, constant CSS px) ==========
      // Program (screen-space; takes CSS px positions/sizes and maps to NDC)
      const triVS = `#version 300 es
        precision highp float;

        layout(location=0) in vec2 a_unit;         // (0,0), (1,0), (0.5,1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px) in canvas-local CSS px
        layout(location=2) in float a_dragFlag;    // 1.0 = apply horizontal drag offset, 0.0 = none

        uniform vec2  u_viewport;                  // canvas CSS px size
        uniform float u_dragCssX;                  // CSS px horizontal drag offset
        uniform float u_dragMask;                  // extra mask for single-instance draws (0 or 1)

        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          // Apply drag only when flagged, plus optional mask for one-off draws
          local.x += (a_dragFlag + u_dragMask) * u_dragCssX;

          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
        }
      `;
      const triFS = `#version 300 es
        precision highp float;
        out vec4 outColor;
        void main() {
          // Much darker grey, slightly less transparent per feedback
          outColor = vec4(0.0, 0.0, 0.0, 0.5);
        }
      `;
      this.measureTriProgram = this._createProgram(triVS, triFS);
      // Cache uniforms for measureTriProgram
      try {
        this._uniforms.measureTri = this._uniforms.measureTri || {};
        if (this.measureTriProgram && this.gl) {
          const gl = this.gl;
          const p = this.measureTriProgram;
          this._uniforms.measureTri.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.measureTri.u_dragCssX = gl.getUniformLocation(p, 'u_dragCssX');
          this._uniforms.measureTri.u_dragMask = gl.getUniformLocation(p, 'u_dragMask');
        }
      } catch {}
      // Outline program (1px line loop) for visible edges over dark backgrounds
      const triOutlineVS = triVS;
      const triOutlineFS = `#version 300 es
        precision highp float;
        uniform vec4 u_color;
        out vec4 outColor;
        void main() {
          outColor = u_color;
        }
      `;
      this.measureTriOutlineProgram = this._createProgram(triOutlineVS, triOutlineFS);
      // Cache uniforms for measureTriOutlineProgram
      try {
        this._uniforms.measureTriOutline = this._uniforms.measureTriOutline || {};
        if (this.measureTriOutlineProgram && this.gl) {
          const gl = this.gl;
          const p = this.measureTriOutlineProgram;
          this._uniforms.measureTriOutline.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.measureTriOutline.u_color    = gl.getUniformLocation(p, 'u_color');
          this._uniforms.measureTriOutline.u_dragCssX = gl.getUniformLocation(p, 'u_dragCssX');
          this._uniforms.measureTriOutline.u_dragMask = gl.getUniformLocation(p, 'u_dragMask');
        }
      } catch {}

      // ========== Base note circle (screen-space SDF disc with border) ==========
      const discVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1) quad
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        out vec2 v_uv;
        out vec2 v_size;
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
          v_uv = a_unit;
          v_size = a_posSizeCss.zw;
        }
      `;
      const discFS = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        in vec2 v_size;
        uniform float u_borderWidth;               // CSS px
        uniform vec4  u_fillColor;                 // RGBA
        uniform vec4  u_borderColor;               // RGBA
        out vec4 outColor;
        void main() {
          // Centered coordinates in CSS px
          vec2 p = (v_uv - vec2(0.5)) * v_size;
          float R = 0.5 * min(v_size.x, v_size.y);
          float d = length(p) - R;

          float aa = max(fwidth(d), 1.0);
          float aOuter = 1.0 - smoothstep(0.0, aa, d);
          float aInner = 1.0 - smoothstep(0.0, aa, d + u_borderWidth);

          float ring = clamp(aOuter - aInner, 0.0, 1.0);
          float interior = clamp(aInner, 0.0, 1.0);

          vec3 rgb = u_borderColor.rgb * ring + u_fillColor.rgb * interior;
          float a   = u_borderColor.a   * ring + u_fillColor.a   * interior;

          if (a <= 0.0) discard;
          outColor = vec4(rgb, a);
        }
      `;
      this.baseCircleProgram = this._createProgram(discVS, discFS);
      // Cache uniforms for baseCircleProgram
      try {
        this._uniforms.baseCircle = this._uniforms.baseCircle || {};
        if (this.baseCircleProgram && this.gl) {
          const gl = this.gl;
          const p = this.baseCircleProgram;
          this._uniforms.baseCircle.u_viewport   = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.baseCircle.u_borderWidth= gl.getUniformLocation(p, 'u_borderWidth');
          this._uniforms.baseCircle.u_fillColor  = gl.getUniformLocation(p, 'u_fillColor');
          this._uniforms.baseCircle.u_borderColor= gl.getUniformLocation(p, 'u_borderColor');
        }
      } catch {}

      // Geometry for base note circle
      this.baseCircleVAO = gl.createVertexArray();
      gl.bindVertexArray(this.baseCircleVAO);

      this._baseCircleUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._baseCircleUnitBuffer);
      const quad = new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.baseCirclePosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.baseCirclePosSize = null;

      // Geometry
      this.measureTriVAO = gl.createVertexArray();
      gl.bindVertexArray(this.measureTriVAO);

      // Unit triangle oriented upward (apex at top)
      const triUnit = new Float32Array([
        0.0, 1.0,
        1.0, 1.0,
        0.5, 0.0
      ]);
      this._measureTriUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._measureTriUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, triUnit, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0); // per-vertex

      // Instance buffer: (x_px, y_px, w_px, h_px) in CSS px
      this.measureTriPosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1); // per-instance

      // Per-instance drag flags for triangles (1 = apply u_dragCssX)
      this.measureTriDragFlagBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriDragFlagBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 1 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      // Outline buffer for triangles (same attrib layout; we will bind per-draw)
      this.measureTriPosSizeOutlineBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeOutlineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.measureTriCount = 0;
      this.measureTriPosSize = null;
      this.measureTriPosSizeOutline = null; // inflated for visible outline
      this._measureTriTimes = null; // world times for triangles (sec)
      this._measureTriIds = null;   // note ids for triangles

      // ========== Octave guides (horizontal dotted orange bars + text) ==========
      // Horizontal dotted line shader (screen-space, pattern along X)
      const hlineVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1) quad
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        out vec2 v_css;
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
          v_css = local;
        }
      `;
      const hlineFS = `#version 300 es
        precision highp float;
        in vec2 v_css;
        uniform float u_dashLen;     // CSS px
        uniform float u_gapLen;      // CSS px
        uniform vec4  u_color;       // RGBA
        // Hole rectangle in CSS px: (x, y, w, h). If fragment lies inside, suppress the line.
        uniform vec4  u_holeRect;
        out vec4 outColor;
        void main() {
          float period = max(1.0, u_dashLen + u_gapLen);
          float m = mod(max(v_css.x, 0.0), period);
          float a = m < u_dashLen ? 1.0 : 0.0;

          // Apply hole to remove dashes behind the label
          bool inHoleX = v_css.x >= u_holeRect.x && v_css.x <= (u_holeRect.x + u_holeRect.z);
          bool inHoleY = v_css.y >= u_holeRect.y && v_css.y <= (u_holeRect.y + u_holeRect.w);
          if (inHoleX && inHoleY) {
            a = 0.0;
          }

          outColor = vec4(u_color.rgb, u_color.a * a);
        }
      `;
      this.octaveLineProgram = this._createProgram(hlineVS, hlineFS);
      // Cache uniforms for octaveLineProgram
      try {
        this._uniforms.octaveLine = this._uniforms.octaveLine || {};
        if (this.octaveLineProgram && this.gl) {
          const gl = this.gl;
          const p = this.octaveLineProgram;
          this._uniforms.octaveLine.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.octaveLine.u_dashLen  = gl.getUniformLocation(p, 'u_dashLen');
          this._uniforms.octaveLine.u_gapLen   = gl.getUniformLocation(p, 'u_gapLen');
          this._uniforms.octaveLine.u_color    = gl.getUniformLocation(p, 'u_color');
          this._uniforms.octaveLine.u_holeRect = gl.getUniformLocation(p, 'u_holeRect');
        }
      } catch {}
      // Vertical dashed line program for silence borders (screen-space; pattern along Y)
      const vlineFS = `#version 300 es
        precision highp float;
        in vec2 v_css;
        uniform float u_dashLen;     // CSS px
        uniform float u_gapLen;      // CSS px
        uniform vec4  u_color;       // RGBA
        out vec4 outColor;
        void main() {
          float period = max(1.0, u_dashLen + u_gapLen);
          float m = mod(max(v_css.y, 0.0), period);
          float a = m < u_dashLen ? 1.0 : 0.0;
          outColor = vec4(u_color.rgb, u_color.a * a);
        }
      `;
      // VS variant with drag flag and u_dragCssX for vertical lines
      const vlineDragVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1) quad
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        layout(location=2) in float a_dragFlag;    // 1.0 = apply u_dragCssX
        uniform vec2  u_viewport;                  // canvas CSS px size
        uniform float u_dragCssX;                  // CSS px horizontal drag offset
        out vec2 v_css;
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          local.x += a_dragFlag * u_dragCssX;
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
          v_css = local;
        }
      `;
      this.silenceVLineProgram = this._createProgram(vlineDragVS, vlineFS);

      // Geometry for horizontal lines (screen-space quads)
      this.octaveLineVAO = gl.createVertexArray();
      gl.bindVertexArray(this.octaveLineVAO);
      this._octaveUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._octaveUnitBuffer);
      const unitQuad = new Float32Array([0,0, 1,0, 1,1, 0,1]);
      gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.octaveLinePosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      // Per-instance drag flags for vertical measure dashes
      this.measureDashDragFlagBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureDashDragFlagBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 1 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Text sprite shader (screen-space textured quads)
      const textVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_z;                         // depth layer for overlay
        out vec2 v_uv;
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, u_z, 1.0);
          v_uv = a_unit;
        }
      `;
      const textFS = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        uniform sampler2D u_tex;
        uniform vec4 u_tint; // can be vec4(1) usually
        out vec4 outColor;
        void main() {
          vec4 c = texture(u_tex, v_uv);
          outColor = c * u_tint;
        }
      `;
      this.textProgram = this._createProgram(textVS, textFS);
      // Cache uniforms for textProgram
      try {
        this._uniforms.text = this._uniforms.text || {};
        if (this.textProgram && this.gl) {
          const gl = this.gl;
          const p = this.textProgram;
          this._uniforms.text.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.text.u_tint     = gl.getUniformLocation(p, 'u_tint');
          this._uniforms.text.u_tex      = gl.getUniformLocation(p, 'u_tex');
          this._uniforms.text.u_z        = gl.getUniformLocation(p, 'u_z');
        }
      } catch {}
 
      // Text VAO with a single instance buffer (we draw per-label to bind per-texture)
      this.textVAO = gl.createVertexArray();
      gl.bindVertexArray(this.textVAO);
      this._textUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._textUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.textPosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Simple SOLID screen-space rectangle program (no dash pattern) for divider
      const solidCssVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_z;                         // depth layer for overlay
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, u_z, 1.0);
        }
      `;
      const solidCssFS = `#version 300 es
        precision highp float;
        uniform vec4 u_color;
        out vec4 outColor;
        void main() {
          outColor = u_color;
        }
      `;
      this.solidCssProgram = this._createProgram(solidCssVS, solidCssFS);
      // Cache uniforms for solidCssProgram
      try {
        this._uniforms.solidCss = this._uniforms.solidCss || {};
        if (this.solidCssProgram && this.gl) {
          const gl = this.gl;
          const p = this.solidCssProgram;
          this._uniforms.solidCss.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.solidCss.u_color    = gl.getUniformLocation(p, 'u_color');
          this._uniforms.solidCss.u_z        = gl.getUniformLocation(p, 'u_z');
        }
      } catch {}

      // Text with circular interior mask (for BaseNote fraction clipping)
      const textCircVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_z;                         // depth
        out vec2 v_uv;
        out vec2 v_css;                            // canvas-local CSS px
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, u_z, 1.0);
          v_uv = a_unit;
          v_css = local;
        }
      `;
      const textCircFS = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        in vec2 v_css;                             // canvas-local CSS px
        uniform sampler2D u_tex;
        uniform vec4 u_tint;
        uniform vec2 u_circleCenter;               // CSS px
        uniform float u_circleRadiusInner;         // CSS px (inner, inside grey border)
        out vec4 outColor;
        void main() {
          vec4 c = texture(u_tex, v_uv);
          vec4 o = c * u_tint;                     // premultiplied alpha input
          // Circular interior mask with AA
          float d = length(v_css - u_circleCenter) - u_circleRadiusInner;
          float aa = max(fwidth(d), 1.0);
          float m = 1.0 - smoothstep(0.0, aa, d);
          outColor = o * m;                        // apply mask to premultiplied color
        }
      `;
      this.textCircMaskProgram = this._createProgram(textCircVS, textCircFS);
      // Cache uniforms for textCircMaskProgram
      try {
        this._uniforms.textCircMask = this._uniforms.textCircMask || {};
        if (this.textCircMaskProgram && this.gl) {
          const gl = this.gl;
          const p = this.textCircMaskProgram;
          this._uniforms.textCircMask.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.textCircMask.u_tint     = gl.getUniformLocation(p, 'u_tint');
          this._uniforms.textCircMask.u_tex      = gl.getUniformLocation(p, 'u_tex');
          this._uniforms.textCircMask.u_z        = gl.getUniformLocation(p, 'u_z');
          this._uniforms.textCircMask.u_circleCenter     = gl.getUniformLocation(p, 'u_circleCenter');
          this._uniforms.textCircMask.u_circleRadiusInner= gl.getUniformLocation(p, 'u_circleRadiusInner');
        }
      } catch {}

      // Solid rectangle with circular interior mask (for BaseNote divider clipping)
      const solidCircVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_z;                         // depth
        out vec2 v_css;                            // canvas-local CSS px
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw;
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, u_z, 1.0);
          v_css = local;
        }
      `;
      const solidCircFS = `#version 300 es
        precision highp float;
        in vec2 v_css;
        uniform vec4 u_color;
        uniform vec2 u_circleCenter;               // CSS px
        uniform float u_circleRadiusInner;         // CSS px
        out vec4 outColor;
        void main() {
          float d = length(v_css - u_circleCenter) - u_circleRadiusInner;
          float aa = max(fwidth(d), 1.0);
          float m = 1.0 - smoothstep(0.0, aa, d);
          outColor = u_color * m;                  // premultiplied-safe since u_color is constant
        }
      `;
      this.solidCssCircMaskProgram = this._createProgram(solidCircVS, solidCircFS);
      // Cache uniforms for solidCssCircMaskProgram
      try {
        this._uniforms.solidCssCircMask = this._uniforms.solidCssCircMask || {};
        if (this.solidCssCircMaskProgram && this.gl) {
          const gl = this.gl;
          const p = this.solidCssCircMaskProgram;
          this._uniforms.solidCssCircMask.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.solidCssCircMask.u_color    = gl.getUniformLocation(p, 'u_color');
          this._uniforms.solidCssCircMask.u_z        = gl.getUniformLocation(p, 'u_z');
          this._uniforms.solidCssCircMask.u_circleCenter     = gl.getUniformLocation(p, 'u_circleCenter');
          this._uniforms.solidCssCircMask.u_circleRadiusInner= gl.getUniformLocation(p, 'u_circleRadiusInner');
        }
      } catch {}

      // CPU caches
      this._octaveLinesPosSize = null;  // Float32Array of [x,y,w,h] per octave
      this._octaveLabelCache = new Map(); // text -> { tex, wCss, hCss, dprW, dprH }
      this._octaveIndices = []; // cached list of K values (e.g., -8..+8)
    };

    // A note "has" a variable iff it has a non-empty expression for it. `n.variables.x` says
    // the same thing, but it is a Proxy trap that allocates/looks up a closure on every read;
    // classifying 100k notes through it cost ~32ms per sync. hasExpression() is the direct
    // question the Proxy itself asks (see Note's proxy get handler).
    const hasVar = (n: Note, name: ExpressionName) => {
      try { return !!(n && typeof n.hasExpression === 'function' && n.hasExpression(name)); }
      catch { return false; }
    };

    // Measure bars: notes flagged `measure` (a start and a duration, drawn as bar lines).
    proto._collectMeasureNotes = function (module) {
      const out = [];
      try {
        for (const id in module.notes) {
          const n = module.notes[id];
          if (n && isMeasureNote(n)) out.push(n);
        }
      } catch {}
      return out;
    };

    // A bar's length is its own duration, in seconds (0 when it has none).
    const barLengthSec = (bar: Note | null | undefined) => {
      try { return toNumber(bar ? bar.getVariable('duration') : null, 0) || 0; }
      catch { return 0; }
    };

    proto._computeModuleEndTime = function (module, measureNotes) {
      let measureEnd = 0;
      try {
        const list = measureNotes || this._collectMeasureNotes(module);
        if (list.length > 0) {
          // Only the latest measure matters — a linear max beats sorting the whole list.
          let lastMeasure = null;
          let lastVal = -Infinity;
          for (let i = 0; i < list.length; i++) {
            const st = list[i].getVariable('startTime');
            if (!st) continue;
            const v = toNumber(st, NaN);
            if (v > lastVal) { lastVal = v; lastMeasure = list[i]; }
          }
          if (lastMeasure) {
            const st = lastMeasure.getVariable('startTime');
            if (st) {
              // The last bar ends at its start plus its own duration (exact add, one conversion)
              const ml = lastMeasure.getVariable('duration');
              measureEnd = toNumber(ml ? st.add(ml) : st, 0);
            }
          }
        }
      } catch {}

      // sync() already walks every note and has its evaluated startTime/duration in hand, so it
      // accumulates this max for free. Re-deriving it here meant a second full pass with two
      // Fraction.valueOf() calls per note (~31ms at 100k). Fall back to the scan if sync()
      // has not run yet, so this stays correct when called standalone.
      let lastNoteEnd = this._maxNoteEndSec;
      if (typeof lastNoteEnd !== 'number' || !isFinite(lastNoteEnd)) {
        lastNoteEnd = 0;
        try {
          for (const id in module.notes) {
            const n = module.notes[id];
            if (!n || Number(id) === 0) continue;   // the BaseNote's duration is the time unit, not a note
            if (hasVar(n, 'startTime') && hasVar(n, 'duration') && hasVar(n, 'frequency')) {
              try {
                const s = toNumber(n.getVariable('startTime'), 0);
                const d = toNumber(n.getVariable('duration'), 0);
                lastNoteEnd = Math.max(lastNoteEnd, s + d);
              } catch {}
            }
          }
        } catch {}
      }
      return Math.max(measureEnd, lastNoteEnd);
    };

    proto._syncMeasureBars = function (module, knownMeasures = null) {
      if (!module) return;

      // Collect measure times. One classification pass, shared with the end-time computation
      // below — this used to be two independent O(N) scans, both going through the Proxy.
      const times = [];
      times.push(0); // origin

      const measureNotes = knownMeasures || this._collectMeasureNotes(module);
      this._syncedMeasures = measureNotes;
      for (let i = 0; i < measureNotes.length; i++) {
        try {
          const st = measureNotes[i].getVariable('startTime');
          if (st != null) times.push(toNumber(st, 0));
        } catch {}
      }

      const endTime = this._computeModuleEndTime(module, measureNotes);
      this._moduleEndTime = endTime;
      if (endTime > 0) times.push(endTime);

      const xsAll = Array.from(new Set(times)).sort((a, b) => a - b);

      // Dashed for ALL measure times including origin and end
      const dashedTimes = xsAll;

      // World sizing based on current scale
      const pxToWorldX = 1.0 / (this.xScalePxPerWU || 1.0);
      const w = Math.max(pxToWorldX, 0.5 * pxToWorldX);
      const h = 20000.0;
      const y = -h * 0.5;

      // Prepare dashed buffers
      const Nd = dashedTimes.length;
      if (!this.measureColors || !this.measurePosSize || this.measurePosSize.length !== Nd * 4) {
        this.measurePosSize = new Float32Array(Nd * 4);
        this.measureColors = new Float32Array(Nd * 4);
      }
      for (let i = 0; i < Nd; i++) {
        const xw = dashedTimes[i] * this._cfgSX() * (this.currentXScaleFactor || 1.0) - w * 0.5;
        const o = i * 4;
        this.measurePosSize[o + 0] = xw;
        this.measurePosSize[o + 1] = y;
        this.measurePosSize[o + 2] = w;
        this.measurePosSize[o + 3] = h;

        // Color is ignored by dashed shader, but keep for consistency
        this.measureColors[o + 0] = 1.0;
        this.measureColors[o + 1] = 1.0;
        this.measureColors[o + 2] = 1.0;
        this.measureColors[o + 3] = 0.35;
      }
      this.measureCount = Nd;

      // Prepare solid buffers (offset-only: one left of start, one right of end)
      const Ns = endTime >= 0 ? 2 : 0;
      if (!this.measureSolidColors || !this.measureSolidPosSize || this.measureSolidPosSize.length !== Ns * 4) {
        this.measureSolidPosSize = new Float32Array(Ns * 4);
        this.measureSolidColors = new Float32Array(Ns * 4);
      }
      const offsetWU = 3.0 * pxToWorldX; // 3 CSS px offsets

      let k = 0;
      // Start-left solid (at origin minus 3px)
      {
        const t0 = 0 * this._cfgSX() * (this.currentXScaleFactor || 1.0);
        const xw = t0 - offsetWU - w * 0.5;
        const o = k * 4;
        this.measureSolidPosSize[o+0] = xw;
        this.measureSolidPosSize[o+1] = y;
        this.measureSolidPosSize[o+2] = w;
        this.measureSolidPosSize[o+3] = h;
        this.measureSolidColors[o+0] = 1.0;
        this.measureSolidColors[o+1] = 1.0;
        this.measureSolidColors[o+2] = 1.0;
        this.measureSolidColors[o+3] = 0.8;
        k++;
      }
      // End-right solid (at end plus 3px)
      {
        const te = endTime * this._cfgSX() * (this.currentXScaleFactor || 1.0);
        const xw = te + offsetWU - w * 0.5;
        const o = k * 4;
        this.measureSolidPosSize[o+0] = xw;
        this.measureSolidPosSize[o+1] = y;
        this.measureSolidPosSize[o+2] = w;
        this.measureSolidPosSize[o+3] = h;
        this.measureSolidColors[o+0] = 1.0;
        this.measureSolidColors[o+1] = 1.0;
        this.measureSolidColors[o+2] = 1.0;
        this.measureSolidColors[o+3] = 0.8;
        k++;
      }
      this.measureSolidCount = Ns;

      // Prepare triangle measure points (one triangle per actual measure note; exclude origin/end)
      try {
        const triTimes = [];
        const triIds: number[] = [];
        // One triangle per measure bar (the list collected above)
        for (let i = 0; i < measureNotes.length; i++) {
          const n = measureNotes[i];
          try {
            const st = n.getVariable('startTime');
            if (st != null) {
              triTimes.push(toNumber(st, 0));
              triIds.push(Number(n.id));
            }
          } catch {}
        }
        // Sort by time and build next arrays
        const zipped = triTimes.map((t, i) => ({ t, id: triIds[i] })).sort((a, b) => a.t - b.t);
        const prevTimes = this._measureTriTimes || null;
        const prevIds = this._measureTriIds || null;
        const nextTimes = zipped.map(z => z.t);
        const nextIds = zipped.map(z => z.id);

        this._measureTriTimes = nextTimes;
        this._measureTriIds = nextIds;

        // Build id -> index map for fast lookup
        try {
          this._measureTriIdToIndex = new Map();
          for (let i = 0; i < this._measureTriIds.length; i++) {
            this._measureTriIdToIndex.set(this._measureTriIds[i], i);
          }
        } catch {}
        // Cache baseline last-measure metadata for efficient end-bar preview
        try {
          if (nextTimes && nextIds && nextTimes.length > 0) {
            const lastIdx = nextTimes.length - 1;
            const lastId = Number(nextIds[lastIdx]);
            const mlSec = barLengthSec(module.getNoteById(lastId));
            this._lastMeasureMeta = {
              id: lastId,
              baseStartSec: Number(nextTimes[lastIdx]) || 0,
              lengthSec: mlSec
            };
          } else {
            this._lastMeasureMeta = null;
          }
        } catch {}

        // Detect data change and bump epoch to trigger immediate rebuild without requiring a viewport change
        let changed = true;
        try {
          changed = !prevTimes || !prevIds || prevTimes.length !== nextTimes.length || prevIds.length !== nextIds.length;
          if (!changed && prevTimes && prevIds) {
            for (let i = 0; i < nextTimes.length; i++) {
              if (prevTimes[i] !== nextTimes[i] || prevIds[i] !== nextIds[i]) { changed = true; break; }
            }
          }
        } catch { changed = true; }

        if (changed) {
          this._triDataEpoch = (this._triDataEpoch || 0) + 1;
          // Safety: also invalidate the previous view-epoch gate
          this._lastTriEpoch = -1;
          this.needsRedraw = true;
        }
      } catch {
        this._measureTriTimes = null;
        this._measureTriIds = null;
      }

      // Upload both sets
      const gl = this.gl;
      if (gl) {
        if (this.measurePosSizeBuffer && this.measureColorBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measurePosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measurePosSize, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureColorBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measureColors, gl.DYNAMIC_DRAW);
        }
        if (this.measureSolidPosSizeBuffer && this.measureSolidColorBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measureSolidPosSize, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidColorBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measureSolidColors, gl.DYNAMIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    };

    proto._renderMeasureBars = function () {
      const gl = this.gl;
      if (!gl || !this.canvas) return;

      const rectCss = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);
 
      // Instance-indexed reads below only run for a synchronized note body.
      const positions = this.posSize!;
      // Prevent measure graphics from writing depth so they never occlude overlays
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);

      // Ensure constant 1 CSS px thickness at any zoom by adjusting widths here
      const pxToWorldX = 1.0 / (this.xScalePxPerWU || 1.0);

      // Update measure buffers only when zoom/viewport epoch changes
      {
        const needUpdate = (this._lastMeasureEpoch !== this._viewEpoch);
        if (needUpdate) {
          // Adjust dashed bars widths (keep centers stable)
          if (this.measurePosSize && this.measureCount > 0) {
            for (let i = 0; i < this.measureCount; i++) {
              const o = i * 4;
              const cx = this.measurePosSize[o + 0] + this.measurePosSize[o + 2] * 0.5;
              const w = pxToWorldX;
              this.measurePosSize[o + 2] = w;
              this.measurePosSize[o + 0] = cx - w * 0.5;
            }
          }
          // Adjust solid bars widths (keep centers stable)
          if (this.measureSolidPosSize && this.measureSolidCount > 0) {
            for (let i = 0; i < this.measureSolidCount; i++) {
              const o = i * 4;
              const cx = this.measureSolidPosSize[o + 0] + this.measureSolidPosSize[o + 2] * 0.5;
              const w = pxToWorldX;
              this.measureSolidPosSize[o + 2] = w;
              this.measureSolidPosSize[o + 0] = cx - w * 0.5;
            }
          }
          // Re-center start/end solid bars; offset scales with initial zoom
          if (this.measureSolidPosSize && this.measureSolidCount === 2) {
            const w = pxToWorldX;
            const offsetWU = 3.0 / (this._xScaleAtInit || (this.xScalePxPerWU || 1.0));
            // Start-left
            const cx0 = 0.0 * this._cfgSX() * (this.currentXScaleFactor || 1.0) - offsetWU;
            this.measureSolidPosSize[0] = cx0 - w * 0.5;
            this.measureSolidPosSize[2] = w;
            // End-right
            const endT = (this._moduleEndTime || 0.0) * this._cfgSX() * (this.currentXScaleFactor || 1.0);
            const cxe = endT + offsetWU;
            const oe = 4;
            this.measureSolidPosSize[oe + 0] = cxe - w * 0.5;
            this.measureSolidPosSize[oe + 2] = w;
          }
          // Upload updated buffers once per epoch
          if (this.gl) {
            const gl = this.gl;
            if (this.measurePosSizeBuffer && this.measurePosSize) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measurePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this.measurePosSize, gl.DYNAMIC_DRAW);
            }
            if (this.measureColorBuffer && this.measureColors) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measureColorBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this.measureColors, gl.DYNAMIC_DRAW);
            }
            if (this.measureSolidPosSizeBuffer && this.measureSolidPosSize) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidPosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this.measureSolidPosSize, gl.DYNAMIC_DRAW);
            }
            if (this.measureSolidColorBuffer && this.measureSolidColors) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidColorBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this.measureSolidColors, gl.DYNAMIC_DRAW);
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
          }
          this._lastMeasureEpoch = this._viewEpoch;
        }
      }

      // 1) Dashed interior measure bars (screen-space infinite vertical lines)
      if (this.drawMeasureBars && this.silenceVLineProgram && this.octaveLineVAO) {
        gl.useProgram(this.silenceVLineProgram);
        const uVP  = gl.getUniformLocation(this.silenceVLineProgram, 'u_viewport');
        const uDash= gl.getUniformLocation(this.silenceVLineProgram, 'u_dashLen');
        const uGap = gl.getUniformLocation(this.silenceVLineProgram, 'u_gapLen');
        const uCol = gl.getUniformLocation(this.silenceVLineProgram, 'u_color');

        if (uVP)  gl.uniform2f(uVP, vpW, vpH);
        if (uDash) gl.uniform1f(uDash, (this._config?.measures?.dashPx ?? 6.0));
        if (uGap)  gl.uniform1f(uGap,  (this._config?.measures?.gapPx  ?? 6.0));
        { const mb = this._measureBarRgb(); if (uCol) gl.uniform4f(uCol, mb[0], mb[1], mb[2], 0.35); } // themed measure bar

        // Build CSS px positions spanning full viewport height from effective measure times
        const triTimesEff = (() => {
          let arr = this._measureTriTimes ? this._measureTriTimes.slice() : [];
          if (this._measurePreview && this._measureTriIdToIndex) {
            for (const id in this._measurePreview) {
              const idx = this._measureTriIdToIndex.get(Number(id));
              if (idx != null && idx >= 0 && idx < arr.length) {
                arr[idx] = this._measurePreview[id];
              }
            }
          }
          return arr;
        })();

        // Unified effective module-end preview based on baselines + drag deltas
        const computeEffectiveEndSec = (triTimes: number[]) => {
          try {
            // Idle path: keep previous precise behavior (no baselines needed)
            if (!this._dragActive) {
              let endFromNotes = 0;
              try {
                const Ninst = Math.max(0, this.instanceCount | 0);
                const denom = this._cfgSX() * (this.currentXScaleFactor || 1.0);
                if (this._rangeIndex && denom > 0 && Number.isFinite(this._rangeIndex.right[1])) {
                  endFromNotes = Math.max(0, this._rangeIndex.right[1] / denom);
                } else for (let i = 0; i < Ninst; i++) {
                  const o = i * 4;
                  const endSec = ((positions[o + 0] || 0) + (positions[o + 2] || 0)) / denom;
                  if (isFinite(endSec)) endFromNotes = Math.max(endFromNotes, endSec);
                }
              } catch {}
              let endFromMeasures = 0;
              try {
                if (triTimes.length && this._measureTriIds && this._measureTriIds.length === triTimes.length && this._moduleRef) {
                  const lastIdx = triTimes.length - 1;
                  const lastId = this._measureTriIds[lastIdx];
                  const lastStart = Number(triTimes[lastIdx]) || 0;
                  let ml = 0;
                  if (this._lastMeasureMeta && this._lastMeasureMeta.id === Number(lastId) && isFinite(this._lastMeasureMeta.lengthSec)) {
                    ml = this._lastMeasureMeta.lengthSec;
                  } else {
                    const lastNote = this._moduleRef.getNoteById(Number(lastId));
                    const mlVal = lastNote ? lastNote.getVariable('duration') : null; // the bar's own length
                    ml = toNumber(mlVal, 0) || 0;
                  }
                  endFromMeasures = Math.max(0, lastStart + ml);
                }
              } catch {}
              let e0 = Math.max(endFromMeasures, endFromNotes);
              if (this._endTimePreviewSec != null) e0 = Math.max(e0, this._endTimePreviewSec);
              return e0;
            }

            // Drag path: derive from drag delta and baselines (no full scans)
            let endFromMeasures = 0;
            try {
              if (triTimes.length && this._measureTriIds && this._measureTriIds.length === triTimes.length && this._moduleRef) {
                const lastIdx = triTimes.length - 1;
                const lastId = this._measureTriIds[lastIdx];
                let lastStart = Number(triTimes[lastIdx]) || 0;
                const hasPrev = !!(this._measurePreview && Object.prototype.hasOwnProperty.call(this._measurePreview, Number(lastId)));
                if (!hasPrev && this._dragMovingIds && this._dragMovingIds.has(Number(lastId))) {
                  lastStart += (this._dragDxSec || 0);
                }
                let ml = 0;
                if (this._lastMeasureMeta && this._lastMeasureMeta.id === Number(lastId) && isFinite(this._lastMeasureMeta.lengthSec)) {
                  ml = this._lastMeasureMeta.lengthSec;
                } else {
                  const lastNote = this._moduleRef.getNoteById(Number(lastId));
                  const mlVal = lastNote ? lastNote.getVariable('duration') : null; // the bar's own length
                  ml = toNumber(mlVal, 0) || 0;
                }
                endFromMeasures = Math.max(0, lastStart + ml);
              }
            } catch {}

            const denom = this._cfgSX() * (this.currentXScaleFactor || 1.0);
            const movingIdx = (this._baselineMovingIdx && this._baselineMovingIdx.length)
              ? this._baselineMovingIdx
              : (this._dragSetIndices || null);

            let movingEnd = 0;
            if (movingIdx && movingIdx.length) {
              const anchorIdx = (this._dragAnchorIndex != null) ? (this._dragAnchorIndex | 0) : -1;
              const dxSec = this._dragDxSec || 0.0;
              const type = (this._dragOverlay && this._dragOverlay.type) || '';
const isResize = !!this._dragLastWasResize || type === 'resize';
const isMove = type === 'move';
              for (let i = 0; i < movingIdx.length; i++) {
                const idx = movingIdx[i] | 0;
                if (idx < 0 || idx >= (this.instanceCount | 0)) continue;
                const o = idx * 4;
                const startSec = (positions[o + 0] || 0) / denom;
                const durSec   = (positions[o + 2] || 0) / denom;
                const isAnchor = (idx === anchorIdx);
const addDx = isAnchor ? 0.0 : dxSec;
const e = startSec + addDx + durSec;
                if (isFinite(e)) movingEnd = Math.max(movingEnd, e);
              }
            }

            let e1 = Math.max(endFromMeasures, (this._baselineNonMovingEndSec || 0), movingEnd);
            if (this._endTimePreviewSec != null) e1 = Math.max(e1, this._endTimePreviewSec);
            return e1;
          } catch { return 0; }
        };

        const endEff = computeEffectiveEndSec(triTimesEff);
        const dashedTimes = [0, ...triTimesEff, endEff];
        const N = dashedTimes.length;
        const css = new Float32Array(N * 4);
        for (let i = 0; i < N; i++) {
          const t = dashedTimes[i] || 0;
          const cxWorld = t * this._cfgSX() * (this.currentXScaleFactor || 1.0);
          const sx = this.matrix[0] * cxWorld + this.matrix[6];
          const localX = (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx;
          const left = Math.round(localX) - 0.5; // crisp 1px
          const o = i * 4;
          css[o + 0] = left;
          css[o + 1] = 0.0;
          css[o + 2] = 1.0;
          css[o + 3] = vpH;
        }

        // Enable drag-flag attribute (loc 2) for dashed bars
        this._setOctaveAttr2Enabled(true);
        gl.bindVertexArray(this.octaveLineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        // Upload per-instance drag flags for dashed bars and set drag uniform (CSS px)
        {
          const uDX = gl.getUniformLocation(this.silenceVLineProgram, 'u_dragCssX');
          const dxCss = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);
          if (uDX) gl.uniform1f(uDX, dxCss);

          const flags = new Float32Array(N);
          // origin (0) and end (N-1) are not direct measure bars
          flags[0] = 0.0;
          flags[N - 1] = 0.0;
          const flaggedIdx = [];
          if (this._dragActive && this._dragMovingIds && this._dragMovingIds.size && this._measureTriIdToIndex) {
            try {
              for (const id of this._dragMovingIds) {
                const idNum = Number(id);
                // Skip those with preview override (position already baked)
                const hasPrev = !!(this._measurePreview && Object.prototype.hasOwnProperty.call(this._measurePreview, idNum));
                if (hasPrev) continue;
                const idx = this._measureTriIdToIndex.get ? this._measureTriIdToIndex.get(idNum) : -1;
                if (idx != null && idx >= 0 && idx < (triTimesEff ? triTimesEff.length : 0)) {
                  const di = 1 + idx; // dashedTimes = [0, ...triTimesEff, endEff]
                  if (di >= 0 && di < N) {
                    flags[di] = 1.0;
                    flaggedIdx.push(di);
                  }
                }
              }
            } catch {}
          }
          // Build a simple signature to gate buffer uploads and avoid per-frame churn
          flaggedIdx.sort((a,b) => a-b);
          const dashKey = `${N}|${flaggedIdx.join(',')}`;
          if (this._lastDashFlagsKey !== dashKey) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.measureDashDragFlagBuffer);
            // Ensure attrib pointer (loc 2) is bound to the correct buffer for ANGLE/D3D robustness
            gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(2, 1);
            gl.bufferData(gl.ARRAY_BUFFER, flags, gl.DYNAMIC_DRAW);
            this._lastDashFlagsKey = dashKey;
          }
        }
        // Rebind posSize buffer after potential flag-buffer upload changed ARRAY_BUFFER binding
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, css, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, N);
        gl.bindVertexArray(null);
        // Disable attrib 2 after dashed bars to avoid affecting other vertical line draws
        this._setOctaveAttr2Enabled(false);
      }

      // 2) Solid start/end bars (screen-space infinite vertical lines)
      if (this.drawMeasureSolids && this.solidCssProgram && this.octaveLineVAO) {
        gl.useProgram(this.solidCssProgram);
        const Us = (this._uniforms && this._uniforms.solidCss) ? this._uniforms.solidCss : null;
        const uVP  = Us ? Us.u_viewport : gl.getUniformLocation(this.solidCssProgram, 'u_viewport');
        const uCol = Us ? Us.u_color    : gl.getUniformLocation(this.solidCssProgram, 'u_color');
        const uZ   = Us ? Us.u_z        : gl.getUniformLocation(this.solidCssProgram, 'u_z');
        if (uVP)  gl.uniform2f(uVP, vpW, vpH);
        { const mb = this._measureBarRgb(); if (uCol) gl.uniform4f(uCol, mb[0], mb[1], mb[2], 0.8); } // themed measure bar (solid start/end)
        if (uZ)   gl.uniform1f(uZ, -0.00002);

        // Compute effective end using the same unified function (reuse triTimes logic)
        const triTimesEff2 = (() => {
          let arr = this._measureTriTimes ? this._measureTriTimes.slice() : [];
          if (this._measurePreview && this._measureTriIdToIndex) {
            for (const id in this._measurePreview) {
              const idx = this._measureTriIdToIndex.get(Number(id));
              if (idx != null && idx >= 0 && idx < arr.length) {
                arr[idx] = this._measurePreview[id];
              }
            }
          }
          return arr;
        })();

        const endEff = (() => {
  const computeEff = (triTimes: number[]) => {
    try {
      // Idle path: same as dashed computation (uses cached last-measure length when available)
      if (!this._dragActive) {
        let endFromNotes = 0;
        const Ninst = Math.max(0, this.instanceCount | 0);
        const denom = this._cfgSX() * (this.currentXScaleFactor || 1.0);
        if (this._rangeIndex && denom > 0 && Number.isFinite(this._rangeIndex.right[1])) {
          endFromNotes = Math.max(0, this._rangeIndex.right[1] / denom);
        } else for (let i = 0; i < Ninst; i++) {
          const o = i * 4;
          const endSec = ((positions[o + 0] || 0) + (positions[o + 2] || 0)) / denom;
          if (isFinite(endSec)) endFromNotes = Math.max(endFromNotes, endSec);
        }
        let endFromMeasures = 0;
        if (triTimes.length && this._measureTriIds && this._measureTriIds.length === triTimes.length && this._moduleRef) {
          const lastIdx = triTimes.length - 1;
          const lastId = this._measureTriIds[lastIdx];
          const lastStart = Number(triTimes[lastIdx]) || 0;
          let ml = 0;
          if (this._lastMeasureMeta && this._lastMeasureMeta.id === Number(lastId) && isFinite(this._lastMeasureMeta.lengthSec)) {
            ml = this._lastMeasureMeta.lengthSec;
          } else {
            const lastNote = this._moduleRef.getNoteById(Number(lastId));
            const mlVal = lastNote ? lastNote.getVariable('duration') : null; // the bar's own length
            ml = toNumber(mlVal, 0) || 0;
          }
          endFromMeasures = Math.max(0, lastStart + ml);
        }
        let e0 = Math.max(endFromMeasures, endFromNotes);
        if (this._endTimePreviewSec != null) e0 = Math.max(e0, this._endTimePreviewSec);
        return e0;
      }

      // Drag path: identical to dashed bars' drag-aware effective end
      let endFromMeasures = 0;
      if (triTimes.length && this._measureTriIds && this._measureTriIds.length === triTimes.length && this._moduleRef) {
        const lastIdx = triTimes.length - 1;
        const lastId = this._measureTriIds[lastIdx];
        let lastStart = Number(triTimes[lastIdx]) || 0;
        const hasPrev = !!(this._measurePreview && Object.prototype.hasOwnProperty.call(this._measurePreview, Number(lastId)));
        if (!hasPrev && this._dragMovingIds && this._dragMovingIds.has(Number(lastId))) {
          lastStart += (this._dragDxSec || 0);
        }
        let ml = 0;
        if (this._lastMeasureMeta && this._lastMeasureMeta.id === Number(lastId) && isFinite(this._lastMeasureMeta.lengthSec)) {
          ml = this._lastMeasureMeta.lengthSec;
        } else {
          const lastNote = this._moduleRef.getNoteById(Number(lastId));
          const mlVal = lastNote ? lastNote.getVariable('duration') : null; // the bar's own length
          ml = toNumber(mlVal, 0) || 0;
        }
        endFromMeasures = Math.max(0, lastStart + ml);
      }

      const denom = this._cfgSX() * (this.currentXScaleFactor || 1.0);
      const movingIdx = (this._baselineMovingIdx && this._baselineMovingIdx.length)
        ? this._baselineMovingIdx
        : (this._dragSetIndices || null);

      let movingEnd = 0;
      if (movingIdx && movingIdx.length) {
        const anchorIdx = (this._dragAnchorIndex != null) ? (this._dragAnchorIndex | 0) : -1;
        const dxSec = this._dragDxSec || 0.0;
        for (let i = 0; i < movingIdx.length; i++) {
          const idx = movingIdx[i] | 0;
          if (idx < 0 || idx >= (this.instanceCount | 0)) continue;
          const o = idx * 4;
          const startSec = (positions[o + 0] || 0) / denom;
          const durSec   = (positions[o + 2] || 0) / denom;
          const isAnchor = (idx === anchorIdx);
          const addDx = isAnchor ? 0.0 : dxSec;
          const e = startSec + addDx + durSec;
          if (isFinite(e)) movingEnd = Math.max(movingEnd, e);
        }
      }

      let e1 = Math.max(endFromMeasures, (this._baselineNonMovingEndSec || 0), movingEnd);
      if (this._endTimePreviewSec != null) e1 = Math.max(e1, this._endTimePreviewSec);
      return e1;
    } catch { return 0; }
  };
  return computeEff(triTimesEff2);
})();

        // Two bars: start-left (-3px) and end-right (+3px)
        const css = new Float32Array(2 * 4);
        // Origin
        {
          const sx0 = this.matrix[0] * 0.0 + this.matrix[6];
          const localX0 = (this.canvasOffset?.x != null) ? (sx0 - this.canvasOffset.x) : sx0;
          const left0 = Math.round(localX0) - 0.5 - 3.0; // 3px left offset
          css[0] = left0; css[1] = 0.0; css[2] = 1.0; css[3] = vpH;
        }
        // End
        {
          const cxWorldE = endEff * this._cfgSX() * (this.currentXScaleFactor || 1.0);
          const sxE = this.matrix[0] * cxWorldE + this.matrix[6];
          const localXE = (this.canvasOffset?.x != null) ? (sxE - this.canvasOffset.x) : sxE;
          const leftE = Math.round(localXE) - 0.5 + 3.0; // 3px right offset
          const o = 4;
          css[o + 0] = leftE; css[o + 1] = 0.0; css[o + 2] = 1.0; css[o + 3] = vpH;
        }

        gl.bindVertexArray(this.octaveLineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        // No per-frame CPU shifting for solid bars (kept as fixed origin/end offsets)
        gl.bufferData(gl.ARRAY_BUFFER, css, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 2);
        gl.bindVertexArray(null);

        // Disable attrib 2 for subsequent non-dashed vertical line draws
        this._setOctaveAttr2Enabled(false);
      }

      // Base note circle (screen-space size that scales with zoom; border scales with zoom like note borders)
      if (this.baseCircleProgram && this.baseCircleVAO) {
        const vpW = Math.max(1, rectCss.width);
        const vpH = Math.max(1, rectCss.height);

        const baseFreq = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);

        // Circle center in world units (keep consistent with legacy: center x at -30 WU, y at base frequency line)
        const xCenterWorld = -30.0;
        const yCenterWorld = this._noteCenterY(baseFreq);

        // World center -> page CSS px
        const sxC = this.matrix[0] * xCenterWorld + this.matrix[3] * yCenterWorld + this.matrix[6];
        const syC = this.matrix[1] * xCenterWorld + this.matrix[4] * yCenterWorld + this.matrix[7];

        // Canvas-local CSS px
        const localCX = (this.canvasOffset?.x != null) ? (sxC - this.canvasOffset.x) : sxC;
        const localCY = (this.canvasOffset?.y != null) ? (syC - this.canvasOffset.y) : syC;

        // Size in CSS px scales with zoom (40 world units mapped through current scales)
        const circleWU = (this._config?.baseNote?.circleSizeWU ?? 40.0);
        const circleW = circleWU * (this.xScalePxPerWU || 1.0);
        const circleH = circleWU * (this.yScalePxPerWU || 1.0);

        // Convert center to top-left for quad placement
        const localX = localCX - 0.5 * circleW;
        const localY = localCY - 0.5 * circleH;

        const arr = new Float32Array([localX, localY, circleW, circleH]);
        // Cache for CPU picking (CSS px)
        try {
          this._baseCircleCss = { cx: localCX, cy: localCY, r: 0.5 * Math.min(circleW, circleH) };
        } catch {}

        // Draw circle
        gl.useProgram(this.baseCircleProgram);
        const Ubc = (this._uniforms && this._uniforms.baseCircle) ? this._uniforms.baseCircle : null;
        const uVPc = Ubc ? Ubc.u_viewport    : gl.getUniformLocation(this.baseCircleProgram, 'u_viewport');
        const uBWc = Ubc ? Ubc.u_borderWidth : gl.getUniformLocation(this.baseCircleProgram, 'u_borderWidth');
        const uFill= Ubc ? Ubc.u_fillColor   : gl.getUniformLocation(this.baseCircleProgram, 'u_fillColor');
        const uBCol= Ubc ? Ubc.u_borderColor : gl.getUniformLocation(this.baseCircleProgram, 'u_borderColor');
        if (uVPc) gl.uniform2f(uVPc, vpW, vpH);
        // Match note borders: 1 CSS px at zoom=1, scaling with zoom via xScalePxPerWU
        { const bw = (this._config?.note?.borderPxAtZoom1 ?? 1.0); if (uBWc) gl.uniform1f(uBWc, bw * (this.xScalePxPerWU || 1.0)); }
        { const a = this._accentRgba(); if (uFill) gl.uniform4f(uFill, a[0], a[1], a[2], a[3]); }        // themed accent (base circle)
        { const b = this._noteBorderRgba(); if (uBCol) gl.uniform4f(uBCol, b[0], b[1], b[2], b[3]); }    // themed border

        gl.bindVertexArray(this.baseCircleVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        gl.bindVertexArray(null);

        // Selected BaseNote ring (2px white outline)
        try {
          if (this._lastSelectedNoteId === 0 && this.baseCircleProgram) {
            gl.useProgram(this.baseCircleProgram);
            const Ubc2 = (this._uniforms && this._uniforms.baseCircle) ? this._uniforms.baseCircle : null;
            const uVPc2 = Ubc2 ? Ubc2.u_viewport    : gl.getUniformLocation(this.baseCircleProgram, 'u_viewport');
            const uBWc2 = Ubc2 ? Ubc2.u_borderWidth : gl.getUniformLocation(this.baseCircleProgram, 'u_borderWidth');
            const uFill2= Ubc2 ? Ubc2.u_fillColor   : gl.getUniformLocation(this.baseCircleProgram, 'u_fillColor');
            const uBCol2= Ubc2 ? Ubc2.u_borderColor : gl.getUniformLocation(this.baseCircleProgram, 'u_borderColor');
            if (uVPc2) gl.uniform2f(uVPc2, vpW, vpH);
            if (uBWc2) gl.uniform1f(uBWc2, (this._config?.selection?.ringThicknessPxAtZoom1 ?? 2.0) * (this.xScalePxPerWU || 1.0)); // 2px at zoom=1
            if (uFill2) gl.uniform4f(uFill2, 1.0, 1.0, 1.0, 0.0);               // no interior fill
            { const sr = this._selectionRingRgba(); if (uBCol2) gl.uniform4f(uBCol2, sr[0], sr[1], sr[2], 1.0); } // themed selection ring

            gl.bindVertexArray(this.baseCircleVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            gl.bindVertexArray(null);
          }
        } catch {}

        // Dependency highlight ring for BaseNote when included in sets
        try {
          if (!this._dragActive && this.baseCircleProgram && this._lastSelectedNoteId !== 0) {
            const drawBaseDepRing = (rgba: number[], widthPx: number) => {
              if (!this.baseCircleProgram) return;
              gl.useProgram(this.baseCircleProgram);
              const U = (this._uniforms && this._uniforms.baseCircle) ? this._uniforms.baseCircle : null;
              const uVP = U ? U.u_viewport : gl.getUniformLocation(this.baseCircleProgram, 'u_viewport');
              const uBW = U ? U.u_borderWidth : gl.getUniformLocation(this.baseCircleProgram, 'u_borderWidth');
              const uFill= U ? U.u_fillColor  : gl.getUniformLocation(this.baseCircleProgram, 'u_fillColor');
              const uCol = U ? U.u_borderColor: gl.getUniformLocation(this.baseCircleProgram, 'u_borderColor');
              if (uVP) gl.uniform2f(uVP, vpW, vpH);
              if (uBW) gl.uniform1f(uBW, (widthPx || 2) * (this.xScalePxPerWU || 1.0));
              if (uFill) gl.uniform4f(uFill, 1,1,1,0);
              if (uCol) gl.uniform4f(uCol, rgba[0], rgba[1], rgba[2], rgba[3]);
              gl.bindVertexArray(this.baseCircleVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              gl.bindVertexArray(null);
            };
            // Property-colored base note rings (themed dep-highlight tokens;
            // classic-orange tokens equal the old orange/teal/purple literals)
            const bFq = this._depFrequencyRgba();
            const bSt = this._depStartTimeRgba();
            const bDu = this._depDurationRgba();
            // Dependencies (what this note depends on from baseNote) - brighter, thicker
            const BASE_DEP_COLORS = {
              frequency: [bFq[0], bFq[1], bFq[2], 0.9],
              startTime: [bSt[0], bSt[1], bSt[2], 0.9],
              duration:  [bDu[0], bDu[1], bDu[2], 0.9]
            };
            // Dependents (baseNote doesn't depend on notes, so this is rarely used)
            const BASE_RDEP_COLORS = {
              frequency: [bFq[0], bFq[1], bFq[2], 0.4],
              startTime: [bSt[0], bSt[1], bSt[2], 0.4],
              duration:  [bDu[0], bDu[1], bDu[2], 0.4]
            };

            // Draw property-colored deps rings for baseNote
            for (const prop of ['startTime', 'frequency', 'duration'] as const) {
              if (this._relDepsHasBaseByProperty?.[prop]) {
                drawBaseDepRing(BASE_DEP_COLORS[prop], 2.5);
              }
            }
            // Draw property-colored rdeps rings for baseNote (if any)
            for (const prop of ['startTime', 'frequency', 'duration'] as const) {
              if (this._relRdepsHasBaseByProperty?.[prop]) {
                drawBaseDepRing(BASE_RDEP_COLORS[prop], 1.5);
              }
            }

            // Fallback for old behavior
            if (this._relDepsHasBase && !this._relDepsHasBaseByProperty?.startTime && !this._relDepsHasBaseByProperty?.frequency && !this._relDepsHasBaseByProperty?.duration) {
              drawBaseDepRing([bSt[0], bSt[1], bSt[2], 0.9], 2.0);
            }
            if (this._relRdepsHasBase && !this._relRdepsHasBaseByProperty?.startTime && !this._relRdepsHasBaseByProperty?.frequency && !this._relRdepsHasBaseByProperty?.duration) {
              drawBaseDepRing([bDu[0], bDu[1], bDu[2], 0.9], 1.0);
            }
          }
        } catch {}

        // Hover ring for BaseNote (1px, slightly dim)
        try {
          if (this._hoverBase && this._lastSelectedNoteId !== 0 && this.baseCircleProgram) {
            gl.useProgram(this.baseCircleProgram);
            const Ubc3 = (this._uniforms && this._uniforms.baseCircle) ? this._uniforms.baseCircle : null;
            const uVPc3 = Ubc3 ? Ubc3.u_viewport    : gl.getUniformLocation(this.baseCircleProgram, 'u_viewport');
            const uBWc3 = Ubc3 ? Ubc3.u_borderWidth : gl.getUniformLocation(this.baseCircleProgram, 'u_borderWidth');
            const uFill3= Ubc3 ? Ubc3.u_fillColor   : gl.getUniformLocation(this.baseCircleProgram, 'u_fillColor');
            const uBCol3= Ubc3 ? Ubc3.u_borderColor : gl.getUniformLocation(this.baseCircleProgram, 'u_borderColor');
            if (uVPc3) gl.uniform2f(uVPc3, vpW, vpH);
            if (uBWc3) gl.uniform1f(uBWc3, 1.0 * (this.xScalePxPerWU || 1.0));   // 1px
            if (uFill3) gl.uniform4f(uFill3, 1.0, 1.0, 1.0, 0.0);
            { const hr = this._hoverRingRgba(); if (uBCol3) gl.uniform4f(uBCol3, hr[0], hr[1], hr[2], 0.75); } // softer, themed hover ring
            gl.bindVertexArray(this.baseCircleVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            gl.bindVertexArray(null);
          }
        } catch {}

        // BaseNote fraction/divider are drawn in the later overlay block to ensure correct layering and zoom-scaling.
      }

      // 3) Measure triangles (screen-space constant size)
      if (this.measureTriProgram && this.measureTriVAO && this._measureTriTimes && this._measureTriTimes.length > 0) {
        const triW = 30.0;  // CSS px
        const triH = 30.0;  // CSS px
        const triTimesForDraw = (() => {
          let arr = this._measureTriTimes ? this._measureTriTimes.slice() : [];
          if (this._measurePreview && this._measureTriIdToIndex) {
            for (const id in this._measurePreview) {
              const idx = this._measureTriIdToIndex.get(Number(id));
              if (idx != null && idx >= 0 && idx < arr.length) {
                arr[idx] = this._measurePreview[id];
              }
            }
          }
          return arr;
        })();
        const count = triTimesForDraw.length;

        // Rebuild and upload triangle instance buffers when zoom/data/preview epoch changes
        if (this._lastTriEpoch !== this._viewEpoch || this._lastTriDataEpoch !== this._triDataEpoch || this._lastTriPreviewEpoch !== this._triPreviewEpoch) {
          if (!this.measureTriPosSize || this.measureTriPosSize.length !== count * 4) {
            this.measureTriPosSize = new Float32Array(count * 4);
          }
          if (!this.measureTriPosSizeOutline || this.measureTriPosSizeOutline.length !== count * 4) {
            this.measureTriPosSizeOutline = new Float32Array(count * 4);
          }

          // Convert world x to canvas-local CSS px using matrix and canvas offset
          for (let i = 0; i < count; i++) {
            const t = triTimesForDraw[i];
            const xwCenter = (t || 0) * this._cfgSX() * (this.currentXScaleFactor || 1.0);

            // world -> page CSS px
            const sx = this.matrix[0] * xwCenter + this.matrix[6];
            // Convert to canvas-local CSS px
            const localX = (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx;

            // Place along bottom edge (constant from bottom)
            const left = localX - triW * 0.5;
            const top  = vpH - triH; // bottom aligned

            const o = i * 4;
            // fill
            this.measureTriPosSize[o + 0] = left;
            this.measureTriPosSize[o + 1] = top;
            this.measureTriPosSize[o + 2] = triW;
            this.measureTriPosSize[o + 3] = triH;

            // outline (inflate by 1 CSS px on all sides)
            const outlinePx = 1.0;
            this.measureTriPosSizeOutline[o + 0] = left - outlinePx;
            this.measureTriPosSizeOutline[o + 1] = top  - outlinePx;
            this.measureTriPosSizeOutline[o + 2] = triW + outlinePx * 2.0;
            this.measureTriPosSizeOutline[o + 3] = triH + outlinePx * 2.0;
          }

          // Upload once per epoch
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measureTriPosSize, gl.DYNAMIC_DRAW);
          // Upload outline buffer once per epoch as well
          if (this.measureTriPosSizeOutlineBuffer && this.measureTriPosSizeOutline) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeOutlineBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.measureTriPosSizeOutline, gl.DYNAMIC_DRAW);
          }
          // Cache CSS-space triangles for CPU picking (left, top, w, h per instance)
          try { this._measureTriCss = this.measureTriPosSize; } catch {}
          this._lastTriEpoch = this._viewEpoch;
          this._lastTriDataEpoch = this._triDataEpoch;
          this._lastTriPreviewEpoch = this._triPreviewEpoch;
        }
if (!this.measureTriPosSize || !this.measureTriPosSizeOutline || !this._measureTriIds) return;
// Build per-instance drag flags for triangles and update CPU picking CSS to match shader shift
{
  const moving = (this._dragActive && this._dragMovingIds && this._dragMovingIds.size) ? this._dragMovingIds : null;
  const dxCss = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);

  // CPU picking CSS array mirroring on-screen triangles
  const triCssPick = moving ? new Float32Array(this.measureTriPosSize) : this.measureTriPosSize;

  const flaggedIdx = [];
  if (moving && this._measureTriIdToIndex) {
    try {
      const candidates = moving.size < count ? moving : (this._measureTriIds || []);
      for (const id of candidates) {
        if (!moving.has(id)) continue;
        const idNum = Number(id);
        const hasPrev = !!(this._measurePreview && Object.prototype.hasOwnProperty.call(this._measurePreview, idNum));
        if (hasPrev) continue;
        const idx = this._measureTriIdToIndex.get ? this._measureTriIdToIndex.get(idNum) : -1;
        if (idx != null && idx >= 0 && idx < count) {
          flaggedIdx.push(idx);
          // Adjust CPU picking left X to match shader shift
          const o = idx * 4;
          triCssPick[o + 0] += dxCss;
        }
      }
    } catch {}
  }
  // Upload flags only when the moving set changes
  flaggedIdx.sort((a,b) => a-b);
  const triKey = `${count}|${flaggedIdx.join(',')}`;
  if (this._lastTriFlagsKey !== triKey) {
    const flags = new Float32Array(count);
    for (const idx of flaggedIdx) flags[idx] = 1;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriDragFlagBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flags, gl.DYNAMIC_DRAW);
    this._lastTriFlagsKey = triKey;
  }
  // Cache CPU picking shape (always reflect current dxCss)
  try { this._measureTriCss = triCssPick; } catch {}
}

// Outline first (inflated), then fill on top to ensure visible edge over dark bg
if (this.measureTriOutlineProgram) {
  gl.useProgram(this.measureTriOutlineProgram);
/* Ensure BaseNote fraction + divider draw last, above circle and guides (ordering-only; no extra frame pass)
Fixes:
- Solid white divider that scales with zoom (thickness relative to circle size, not a fixed 1px)
- Text size proportional to circle size with wide clamp to avoid inversion at zoom extremes
- Numerator/denominator hug the divider with 1–2px dynamic gap
*/
try {
if (this.drawBaseFraction && this.textProgram && this.textVAO && this.octaveLineProgram && this.octaveLineVAO) {
// Viewport in CSS px
const rectCss2 = this.canvas.getBoundingClientRect();
const vpW2 = Math.max(1, rectCss2.width);
const vpH2 = Math.max(1, rectCss2.height);

// BaseNote circle geometry in screen space (CSS px)
const baseFreq2 = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
const xCenterWorld2 = -30.0;
const yCenterWorld2 = this._noteCenterY(baseFreq2);

// World center -> page CSS px
const sxC2 = this.matrix[0] * xCenterWorld2 + this.matrix[3] * yCenterWorld2 + this.matrix[6];
const syC2 = this.matrix[1] * xCenterWorld2 + this.matrix[4] * yCenterWorld2 + this.matrix[7];

// Canvas-local CSS px
const localCX2 = (this.canvasOffset?.x != null) ? (sxC2 - this.canvasOffset.x) : sxC2;
const localCY2 = (this.canvasOffset?.y != null) ? (syC2 - this.canvasOffset.y) : syC2;

// Circle CSS size scales with zoom
const circleWU2 = (this._config?.baseNote?.circleSizeWU ?? 40.0);
const circleW2 = circleWU2 * (this.xScalePxPerWU || 1.0);
const circleH2 = circleWU2 * (this.yScalePxPerWU || 1.0);

const localX2 = localCX2 - 0.5 * circleW2;
const localY2 = localCY2 - 0.5 * circleH2;

// Layout metrics BEFORE sizing divider
const minDim2 = Math.max(1.0, Math.min(circleW2, circleH2));
const fontPx2 = this.useGlyphCache ? Math.max(4, Math.round(minDim2 * 0.34)) : this._clampFontPx(Math.max(4, Math.round(minDim2 * 0.34)));
const gapPx2  = Math.max(1, Math.round(fontPx2 * 0.08));

// Determine content widths either via glyph-cache or canvas textures (fallback)
const numStr2 = String(this._baseFracNum || '1');
const denStr2 = String(this._baseFracDen || '1');

let numEntry2 = null, denEntry2 = null;
let numEntry2W = 0,   denEntry2W = 0;

if (this.useGlyphCache) {
numEntry2W = this._measureGlyphRunWidth(numStr2, fontPx2);
denEntry2W = this._measureGlyphRunWidth(denStr2, fontPx2);
} else {
numEntry2 = this._createTightDigitTexture(numStr2, fontPx2, 0, this._noteTextHex());
denEntry2 = this._createTightDigitTexture(denStr2, fontPx2, 0, this._noteTextHex());
numEntry2W = (numEntry2 && numEntry2.wCss) ? numEntry2.wCss : 0.0;
denEntry2W = (denEntry2 && denEntry2.wCss) ? denEntry2.wCss : 0.0;
}

// Compute divider width from content + small padding
const contentMax2 = Math.max(numEntry2W, denEntry2W);
const extra2 = 2.0;
const dividerW2 = Math.max(6.0, contentMax2 + extra2);
const leftDiv2 = localCX2 - dividerW2 * 0.5;

// 1) Centered divider line — scales with zoom (thickness relative to circle height), inset to avoid AA bleeding
{
const thicknessPx = Math.max(1, Math.round(fontPx2 * 0.12));
const yCenter = localY2 + circleH2 * 0.5;
const dividerY2 = Math.floor(yCenter - thicknessPx * 0.5) + 0.5; // pixel-snapped

const posDiv2 = new Float32Array([leftDiv2, dividerY2, dividerW2, thicknessPx]);

// Inner circle radius (inside border) for clipping
const borderPxIn = (this.xScalePxPerWU || 1.0);
const innerR = 0.5 * minDim2 - borderPxIn;

if (this.solidCssCircMaskProgram && this.octaveLineVAO && this.octaveLinePosSizeBuffer) {
 gl.useProgram(this.solidCssCircMaskProgram);
 const Ucmask = (this._uniforms && this._uniforms.solidCssCircMask) ? this._uniforms.solidCssCircMask : null;
 const uVPm = Ucmask ? Ucmask.u_viewport : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_viewport');
 const uZm  = Ucmask ? Ucmask.u_z        : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_z');
 const uColm= Ucmask ? Ucmask.u_color    : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_color');
 const uCtr = Ucmask ? Ucmask.u_circleCenter      : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_circleCenter');
 const uRad = Ucmask ? Ucmask.u_circleRadiusInner : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_circleRadiusInner');
 if (uVPm) gl.uniform2f(uVPm, vpW2, vpH2);
 if (uZm)  gl.uniform1f(uZm, -0.00001); // on top
 { const tc = this._noteTextRgba(); if (uColm) gl.uniform4f(uColm, tc[0], tc[1], tc[2], 1.0); }
 if (uCtr) gl.uniform2f(uCtr, localCX2, localCY2);
 if (uRad) gl.uniform1f(uRad, innerR);

 gl.bindVertexArray(this.octaveLineVAO);
 gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
 gl.bufferData(gl.ARRAY_BUFFER, posDiv2, gl.DYNAMIC_DRAW);
 gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
 gl.bindVertexArray(null);
}

// 2) Numerator/Denominator — masked to inner circle
if (this.useGlyphCache) {
 // PMA for glyph textures and ensure top layering
 gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
 gl.disable(gl.DEPTH_TEST);

 const ascNum2 = (this._measureRunMetricsCanvas && this._measureRunMetricsCanvas(numStr2, fontPx2).ascent) || this._getRunAscent(numStr2, fontPx2);
 const runHDen2 = this._getRunHeight(denStr2, fontPx2);
 const sxNum2 = (numEntry2W > dividerW2) ? (dividerW2 / Math.max(1, numEntry2W)) : 1.0;
 const sxDen2 = (denEntry2W > dividerW2) ? (dividerW2 / Math.max(1, denEntry2W)) : 1.0;
 const usedNumW2 = numEntry2W * sxNum2;
 const usedDenW2 = denEntry2W * sxDen2;
 const nx2 = leftDiv2 + Math.max(0, Math.round((dividerW2 - usedNumW2) * 0.5));
 const dx2 = leftDiv2 + Math.max(0, Math.round((dividerW2 - usedDenW2) * 0.5));
 const ny2 = Math.round((dividerY2 - gapPx2 - ascNum2) * 2.0) / 2.0;
 const dy2 = Math.round((dividerY2 + thicknessPx + gapPx2) * 2.0) / 2.0;

 // Bind masked text program once per run
 if (this.textCircMaskProgram) {
   const prog = this.textCircMaskProgram;
   gl.useProgram(prog);
   const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
   const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(prog, 'u_viewport');
   const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(prog, 'u_tint');
   const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(prog, 'u_tex');
   const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(prog, 'u_z');
   const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(prog, 'u_circleCenter');
   const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(prog, 'u_circleRadiusInner');
   if (uVPtm) gl.uniform2f(uVPtm, vpW2, vpH2);
   { const tc = this._noteTextRgba(); if (uTintm) gl.uniform4f(uTintm, tc[0], tc[1], tc[2], 1); }
   if (uTexm) gl.uniform1i(uTexm, 0);
   if (uZtm)  gl.uniform1f(uZtm, -0.00001);
   if (uCtrT) gl.uniform2f(uCtrT, localCX2, localCY2);
   if (uRadT) gl.uniform1f(uRadT, innerR);

   // Draw numerator glyph-run
   {
     let penX = nx2;
     for (let i = 0; i < numStr2.length; i++) {
       const ch = numStr2[i];
       const g = this._getGlyph(ch);
       if (!g || !g.tex) continue;
       const scale = Math.max(1e-6, fontPx2 / (g.basePx || 64));
       const w = g.wCss * scale * sxNum2;
       const h = g.hCss * scale;
       const arr = new Float32Array([penX, ny2, w, h]);
       gl.activeTexture(gl.TEXTURE0);
       gl.bindTexture(gl.TEXTURE_2D, g.tex);
       gl.bindVertexArray(this.textVAO);
       gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
       gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
       gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
       penX += w;
     }
   }

   // Draw denominator glyph-run
   {
     let penX = dx2;
     for (let i = 0; i < denStr2.length; i++) {
       const ch = denStr2[i];
       const g = this._getGlyph(ch);
       if (!g || !g.tex) continue;
       const scale = Math.max(1e-6, fontPx2 / (g.basePx || 64));
       const w = g.wCss * scale * sxDen2;
       const h = g.hCss * scale;
       const arr = new Float32Array([penX, dy2, w, h]);
       gl.activeTexture(gl.TEXTURE0);
       gl.bindTexture(gl.TEXTURE_2D, g.tex);
       gl.bindVertexArray(this.textVAO);
       gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
       gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
       gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
       penX += w;
     }
   }

   // Restore default blend
   gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
   gl.depthMask(true);
   gl.bindVertexArray(null);
   gl.bindTexture(gl.TEXTURE_2D, null);
 }
} else {
 // Fallback: canvas textures masked (existing path)
 {
   const uVPt = gl.getUniformLocation(this.textProgram, 'u_viewport');
   const uTint = gl.getUniformLocation(this.textProgram, 'u_tint');
   const uTex = gl.getUniformLocation(this.textProgram, 'u_tex');

   gl.useProgram(this.textProgram);
   if (uVPt)  gl.uniform2f(uVPt, vpW2, vpH2);
   if (uTint) gl.uniform4f(uTint, 1.0, 1.0, 1.0, 1.0);
   if (uTex)  gl.uniform1i(uTex, 0);

   // PMA for bright text over orange fill
   gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
   gl.disable(gl.DEPTH_TEST);

   // Numerator above divider (gapPx2), centered horizontally — masked to inner circle
   if (numEntry2 && numEntry2.tex) {
     const numW2 = Math.min(numEntry2.wCss, dividerW2);
     const nx2 = leftDiv2 + Math.max(0, Math.round((dividerW2 - numW2) * 0.5));
     const ascNum2 = (typeof numEntry2.ascent === 'number') ? numEntry2.ascent : numEntry2.hCss;
     const ny2 = Math.round((dividerY2 - gapPx2 - ascNum2) * 2.0) / 2.0;

     if (this.textCircMaskProgram) {
       gl.useProgram(this.textCircMaskProgram);
       const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
       const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(this.textCircMaskProgram, 'u_viewport');
       const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(this.textCircMaskProgram, 'u_tint');
       const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(this.textCircMaskProgram, 'u_tex');
       const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(this.textCircMaskProgram, 'u_z');
       const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleCenter');
       const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleRadiusInner');
       if (uVPtm) gl.uniform2f(uVPtm, vpW2, vpH2);
       if (uTintm)gl.uniform4f(uTintm, 1, 1, 1, 1);
       if (uTexm) gl.uniform1i(uTexm, 0);
       if (uZtm)  gl.uniform1f(uZtm, -0.00001);
       if (uCtrT) gl.uniform2f(uCtrT, localCX2, localCY2);
       if (uRadT) gl.uniform1f(uRadT, innerR);

       const arrNum2 = new Float32Array([nx2, ny2, numW2, numEntry2.hCss]);
       gl.activeTexture(gl.TEXTURE0);
       gl.bindTexture(gl.TEXTURE_2D, numEntry2.tex);
       gl.bindVertexArray(this.textVAO);
       gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
       gl.bufferData(gl.ARRAY_BUFFER, arrNum2, gl.DYNAMIC_DRAW);
       gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
     }
   }

   // Denominator below divider (gapPx2), centered horizontally — masked to inner circle
   if (denEntry2 && denEntry2.tex) {
     const denW2 = Math.min(denEntry2.wCss, dividerW2);
     const dx2 = leftDiv2 + Math.max(0, Math.round((dividerW2 - denW2) * 0.5));
     const ascDen2 = (typeof denEntry2.ascent === 'number') ? denEntry2.ascent : denEntry2.hCss;
     const dy2 = Math.round((dividerY2 + thicknessPx + gapPx2) * 2.0) / 2.0;

     if (this.textCircMaskProgram) {
       gl.useProgram(this.textCircMaskProgram);
       const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
       const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(this.textCircMaskProgram, 'u_viewport');
       const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(this.textCircMaskProgram, 'u_tint');
       const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(this.textCircMaskProgram, 'u_tex');
       const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(this.textCircMaskProgram, 'u_z');
       const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleCenter');
       const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleRadiusInner');
       if (uVPtm) gl.uniform2f(uVPtm, vpW2, vpH2);
       if (uTintm)gl.uniform4f(uTintm, 1, 1, 1, 1);
       if (uTexm) gl.uniform1i(uTexm, 0);
       if (uZtm)  gl.uniform1f(uZtm, -0.00001);
       if (uCtrT) gl.uniform2f(uCtrT, localCX2, localCY2);
       if (uRadT) gl.uniform1f(uRadT, innerR);

       const arrDen2 = new Float32Array([dx2, dy2, denW2, denEntry2.hCss]);
       gl.activeTexture(gl.TEXTURE0);
       gl.bindTexture(gl.TEXTURE_2D, denEntry2.tex);
       gl.bindVertexArray(this.textVAO);
       gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
       gl.bufferData(gl.ARRAY_BUFFER, arrDen2, gl.DYNAMIC_DRAW);
       gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
     }
   }

   // Restore default blend
   gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
   gl.depthMask(true);
   gl.bindVertexArray(null);
   gl.bindTexture(gl.TEXTURE_2D, null);
 }
}
}
}
} catch {}
  // Re-bind the correct program after intermediate overlay draws switched programs
  gl.useProgram(this.measureTriOutlineProgram);
  const Uto = (this._uniforms && this._uniforms.measureTriOutline) ? this._uniforms.measureTriOutline : null;
  const uVPto = Uto ? Uto.u_viewport : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_viewport');
  const uColOutline = Uto ? Uto.u_color : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_color');
  if (uVPto) gl.uniform2f(uVPto, vpW, vpH);
  if (uColOutline) gl.uniform4f(uColOutline, 1.0, 1.0, 1.0, 0.5);
  // Set drag uniforms (CSS px) and default mask 0 for instanced outline draw
  {
    const uDX = gl.getUniformLocation(this.measureTriOutlineProgram, 'u_dragCssX');
    const uMask = gl.getUniformLocation(this.measureTriOutlineProgram, 'u_dragMask');
    const dxCss = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);
    if (uDX) gl.uniform1f(uDX, dxCss);
    if (uMask) gl.uniform1f(uMask, 0.0);
  }

  gl.bindVertexArray(this.measureTriVAO);
  // Upload outline array (no CPU drag; shader handles movement)
  gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, this.measureTriPosSizeOutline, gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, count);
  gl.bindVertexArray(null);
}

gl.useProgram(this.measureTriProgram);
const Um = (this._uniforms && this._uniforms.measureTri) ? this._uniforms.measureTri : null;
const uVPt = Um ? Um.u_viewport : gl.getUniformLocation(this.measureTriProgram, 'u_viewport');
if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
// Set drag uniforms (CSS px) and default mask 0
{
  const uDX = gl.getUniformLocation(this.measureTriProgram, 'u_dragCssX');
  const uMask = gl.getUniformLocation(this.measureTriProgram, 'u_dragMask');
  const dxCss = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);
  if (uDX) gl.uniform1f(uDX, dxCss);
  if (uMask) gl.uniform1f(uMask, 0.0);
}

gl.bindVertexArray(this.measureTriVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
// Upload fill array (no CPU drag; shader handles movement)
gl.bufferData(gl.ARRAY_BUFFER, this.measureTriPosSize, gl.DYNAMIC_DRAW);
gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, count);
gl.bindVertexArray(null);

// Dependency/dependent measure outlines and hover (drawn first so selected outline renders on top)
try {
  if (this.measureTriOutlineProgram && this._measureTriIds && this._measureTriIds.length) {
    // Ensure the correct program is bound before setting any uniforms to avoid
    // "uniform*: location is not from the associated program" errors.
    gl.useProgram(this.measureTriOutlineProgram);
    const UtoD = (this._uniforms && this._uniforms.measureTriOutline) ? this._uniforms.measureTriOutline : null;
    const uVPd = UtoD ? UtoD.u_viewport : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_viewport');
    const uColD = UtoD ? UtoD.u_color : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_color');
    if (uVPd) gl.uniform2f(uVPd, vpW, vpH);

    const drawTriOutlineAtIndex = (idx: number | null | undefined, rgba: number[], inflateArr: Float32Array<ArrayBuffer> | null | undefined) => {
      if (!this.measureTriOutlineProgram || !this._measureTriIds || idx == null) return;
      if (idx == null || idx < 0 || idx >= this._measureTriIds.length) return;
      const o = idx * 4;
      const src = inflateArr || this.measureTriPosSizeOutline;
      if (!src) return;
      const arr = new Float32Array([
        src[o + 0], src[o + 1], src[o + 2], src[o + 3]
      ]);
      gl.useProgram(this.measureTriOutlineProgram);
      if (uColD) gl.uniform4f(uColD, rgba[0], rgba[1], rgba[2], rgba[3]);
      // Set drag mask per id when moving
      {
        const uDX = gl.getUniformLocation(this.measureTriOutlineProgram, 'u_dragCssX');
        const uMask = gl.getUniformLocation(this.measureTriOutlineProgram, 'u_dragMask');
        const dxCss = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);
        if (uDX) gl.uniform1f(uDX, dxCss);
        const idHere = this._measureTriIds[idx];
        const moving = !!(this._dragActive && this._dragMovingIds && this._dragMovingIds.has(idHere) && !(this._measurePreview && Object.prototype.hasOwnProperty.call(this._measurePreview, idHere)));
        // Force per-triangle shift when drawing a single outline instance so it tracks during drag
        if (uMask) gl.uniform1f(uMask, moving ? 1.0 : 0.0);
      }
      gl.bindVertexArray(this.measureTriVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      // Upload zero drag flag for single-instance draw to avoid double-offset
      // (shader adds both a_dragFlag and u_dragMask; we use u_dragMask for single draws)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriDragFlagBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0.0]), gl.DYNAMIC_DRAW);
      // Invalidate flags cache so next frame re-uploads full flags array
      this._lastTriFlagsKey = null;
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 1);
      gl.bindVertexArray(null);
    };

    const idToIdx = this._measureTriIdToIndex || null;

    // Dependencies: teal
    // During drag, use prospective parent if set (overrides actual dependencies)
    if (this._lastSelectedNoteId !== 0) {
      const prospPid = this._prospectiveParentId;
      const prospectiveIsMeasure = (prospPid != null && prospPid !== 0 && idToIdx && idToIdx.has(Number(prospPid)));
      const prospectiveIsBase = (prospPid === 0);

      if (this._dragActive && prospPid != null) {
        // During drag with a prospective parent:
        // - If prospective is a measure: draw teal outline on it
        // - If prospective is BaseNote (0): draw nothing (no teal measure outline)
        if (prospectiveIsMeasure) {
          const idx = idToIdx.get(Number(prospPid));
          const st = this._depStartTimeRgba();
          drawTriOutlineAtIndex(idx, [st[0], st[1], st[2], 0.9], this.measureTriPosSizeOutline);
        }
        // else: prospective is BaseNote, don't draw any teal measure outline
      } else if (this._relDepsMeasureIds && this._relDepsMeasureIds.length) {
        // Normal case (not dragging or no prospective): draw actual dependencies
        const st = this._depStartTimeRgba();
        for (let i = 0; i < this._relDepsMeasureIds.length; i++) {
            const id = Number(this._relDepsMeasureIds[i]);
            const idx = idToIdx ? idToIdx.get(id) : (this._measureTriIds ? this._measureTriIds.indexOf(id) : -1);
            drawTriOutlineAtIndex(idx, [st[0], st[1], st[2], 0.9], this.measureTriPosSizeOutline);
        }
      }
    }
    // Dependents: neon deep purple
    if (this._lastSelectedNoteId !== 0 && this._relRdepsMeasureIds && this._relRdepsMeasureIds.length) {
      const du = this._depDurationRgba();
      for (let i = 0; i < this._relRdepsMeasureIds.length; i++) {
        const id = Number(this._relRdepsMeasureIds[i]);
        const idx = idToIdx ? idToIdx.get(id) : (this._measureTriIds ? this._measureTriIds.indexOf(id) : -1);
        drawTriOutlineAtIndex(idx, [du[0], du[1], du[2], 0.9], this.measureTriPosSizeOutline);
      }
    }
    // Hover outline for measures
    if (this._hoveredMeasureId != null && this._hoveredMeasureId !== this._lastSelectedNoteId) {
      const id = Number(this._hoveredMeasureId);
      const idx = idToIdx ? idToIdx.get(id) : (this._measureTriIds ? this._measureTriIds.indexOf(id) : -1);
      const hr = this._hoverRingRgba();
      drawTriOutlineAtIndex(idx, [hr[0], hr[1], hr[2], 0.6], this.measureTriPosSizeOutline);
    }

    const rect = this._marqueeRect;
    this._ensureMultiSelIndices();
    const committed = !rect || rect.additive ? this._multiSelMeasureIds : null;
    if ((rect || committed?.length) && this._measureTriCss) {
      const css = this._measureTriCss;
      let cache = this._measureRingCache;
      if (!cache || cache.rect !== rect || cache.committed !== committed || cache.css !== css
          || cache.map !== idToIdx || cache.view !== this._viewEpoch || cache.preview !== this._triPreviewEpoch) {
        const selected = new Set(rect ? this._measureRectHits(rect.x0, rect.y0, rect.x1, rect.y1) : []);
        for (const id of committed || []) selected.add(id);
        const entries = [];
        for (const id of selected) {
          const i = idToIdx?.get(id);
          if (i == null) continue;
          const o = i * 4;
          entries.push(css[o] - 1, css[o + 1] - 1, css[o + 2] + 2, css[o + 3] + 2);
        }
        cache = this._measureRingCache = { rect, committed, css, map: idToIdx, view: this._viewEpoch,
          preview: this._triPreviewEpoch, boxes: new Float32Array(entries) };
      }
      const boxes = cache.boxes;
      if (boxes.length) {
        gl.uniform4fv(uColD, this._multiSelRingRgba());
        // Picking boxes already carry the live drag offset.
        gl.uniform1f(this._uniforms.measureTriOutline.u_dragCssX, 0);
        gl.bindVertexArray(this.measureTriVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, boxes, gl.DYNAMIC_DRAW);
        gl.disableVertexAttribArray(2);
        gl.drawArraysInstanced(gl.LINE_LOOP, 0, 3, boxes.length / 4);
        gl.enableVertexAttribArray(2);
        gl.bindVertexArray(null);
      }
    }
  }
} catch {}

// Selected measure triangle strong outline (2px) on top of dependency/dependent outlines
try {
  if (this._lastSelectedNoteId != null && this._measureTriIds && this.measureTriPosSize && this.measureTriOutlineProgram) {
    const selId = Number(this._lastSelectedNoteId);
    const idx = this._measureTriIds.indexOf ? this._measureTriIds.indexOf(selId) : -1;
    if (idx >= 0) {
      const o = idx * 4;
      const left = this.measureTriPosSize[o + 0];
      const top  = this.measureTriPosSize[o + 1];
      const w    = this.measureTriPosSize[o + 2];
      const h    = this.measureTriPosSize[o + 3];
      // Inflate by 2 CSS px for a visible outline
      const inflate = 2.0;
      const arrSel = new Float32Array([left - inflate, top - inflate, w + 2 * inflate, h + 2 * inflate]);

      gl.useProgram(this.measureTriOutlineProgram);
      const Uto2 = (this._uniforms && this._uniforms.measureTriOutline) ? this._uniforms.measureTriOutline : null;
      const uVPto2 = Uto2 ? Uto2.u_viewport : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_viewport');
      const uColSel = Uto2 ? Uto2.u_color : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_color');
      if (uVPto2) gl.uniform2f(uVPto2, vpW, vpH);
      { const sr = this._selectionRingRgba(); if (uColSel) gl.uniform4f(uColSel, sr[0], sr[1], sr[2], 1.0); }
      // Apply drag mask for selected if moving (and not preview-baked)
      {
        const uDX = gl.getUniformLocation(this.measureTriOutlineProgram, 'u_dragCssX');
        const uMask = gl.getUniformLocation(this.measureTriOutlineProgram, 'u_dragMask');
        const dxCss = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);
        if (uDX) gl.uniform1f(uDX, dxCss);
const movingSel = !!(this._dragActive && this._dragMovingIds && this._dragMovingIds.has(selId) && !(this._measurePreview && Object.prototype.hasOwnProperty.call(this._measurePreview, selId)));
if (uMask) gl.uniform1f(uMask, movingSel ? 1.0 : 0.0);
      }

      gl.bindVertexArray(this.measureTriVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, arrSel, gl.DYNAMIC_DRAW);
      // Upload zero drag flag for single-instance draw to avoid double-offset
      // (shader adds both a_dragFlag and u_dragMask; we use u_dragMask for single draws)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriDragFlagBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0.0]), gl.DYNAMIC_DRAW);
      // Invalidate flags cache so next frame re-uploads full flags array
      this._lastTriFlagsKey = null;
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 1);
      gl.bindVertexArray(null);
    }
  }
} catch {}

// Draw triangle labels "[id]" over the triangles (centered, narrow texture) — near bottom edge
// This pass occurs AFTER triangle outline+fill so text is on top (not darkened by triangle alpha).
{
  const reuseTextRuns = !!(this.useGlyphAtlas && this.useGlyphCache && this._glyphRunsCache && !this._textDirty && this._lastTextViewEpoch === this._viewEpoch && this._lastTextPosEpoch === this._posEpoch && this._lastTextDragEpoch === this._dragEpoch);
  if (!reuseTextRuns) {
    if (!this._deferredGlyphRuns) this._deferredGlyphRuns = [];
    const padX = 2.0;
    const baseFontPx = 11;            // slightly larger for legibility
    const minScaleX = 0.9;            // limit compression to keep digits readable

    for (let i = 0; i < count; i++) {
      const id = this._measureTriIds[i];
      const label = `[${id}]`;
      const o = i * 4;
      const triLeft = this.measureTriPosSize[o + 0];
      const triTop  = this.measureTriPosSize[o + 1];
      const triW    = this.measureTriPosSize[o + 2];
      const triH    = this.measureTriPosSize[o + 3];

      const runW0 = this._measureGlyphRunWidth(label, baseFontPx);
      const runH0 = this._getRunHeight(label, baseFontPx);

      // Horizontal fit with minimum compression for legibility
      const scaleX = Math.max(minScaleX, Math.min(1.0, (triW - padX) / Math.max(1, runW0)));
      const usedW = runW0 * scaleX;
      let x = triLeft + triW * 0.5 - usedW * 0.5;
      let y = triTop + triH - runH0 - 0.5;

      x = Math.max(triLeft, Math.min(x, triLeft + triW - usedW));
      y = Math.max(triTop,  Math.min(y, triTop + triH - runH0));

      this._deferredGlyphRuns.push({
        text: label,
        noteId: id,
        x,
        y,
        fontPx: baseFontPx,
        color: this._accentRgba(), // themed accent (base-note fraction label)
        layerZ: -0.00001,
        scaleX,
        scLeft: triLeft, scTop: triTop, scW: triW, scH: triH
      });
    }
  }
}
}


      // 4) Octave guides (horizontal dotted orange bars + labels) — disabled with GL overlay parity
      if (this.drawOctaveGuides) {
        try { this._renderOctaveGuides(); } catch {}
      }
      // 4b) Reference lines: notes with a frequency and no duration
      try { this._renderReferenceLines(); } catch {}

      // Restore depth state for subsequent passes (note overlays/text flush)
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    };

    // Draw BaseNote fraction/divider when there are no measure triangles (clean slate)
    // This avoids the previous coupling where the fraction was rendered only from the triangle pass.
    proto._renderBaseFractionIfMissing = function () {
      const gl = this.gl;
      const canvas = this.canvas;
      if (!gl || !canvas) return;
      if (!this.drawBaseFraction) return;

      // If measure triangles exist, their pass already renders the fraction to maintain ordering.
      if (this._measureTriTimes && this._measureTriTimes.length > 0) return;

      const rectCss = canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      // BaseNote circle center in screen space (CSS px)
      const baseFreq = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
      const xCenterWorld = -30.0;
      const yCenterWorld = this._noteCenterY(baseFreq);

      // world -> page CSS px
      const sxC = this.matrix[0] * xCenterWorld + this.matrix[3] * yCenterWorld + this.matrix[6];
      const syC = this.matrix[1] * xCenterWorld + this.matrix[4] * yCenterWorld + this.matrix[7];

      // page -> canvas-local CSS px
      const localCX = (this.canvasOffset?.x != null) ? (sxC - this.canvasOffset.x) : sxC;
      const localCY = (this.canvasOffset?.y != null) ? (syC - this.canvasOffset.y) : syC;

      // Circle size in CSS px, scales with zoom
      const circleWU = (this._config?.baseNote?.circleSizeWU ?? 40.0);
      const circleW = circleWU * (this.xScalePxPerWU || 1.0);
      const circleH = circleWU * (this.yScalePxPerWU || 1.0);
      const minDim = Math.max(1.0, Math.min(circleW, circleH));

      // Text metrics
      const fontPx = this.useGlyphCache ? Math.max(4, Math.round(minDim * 0.34)) : this._clampFontPx(Math.max(4, Math.round(minDim * 0.34)));
      const gapPx  = Math.max(1, Math.round(fontPx * 0.08));

      // Content strings (persisted in sync())
      const numStr = String(this._baseFracNum || '1');
      const denStr = String(this._baseFracDen || '1');

      let numW = 0, denW = 0, numEntry = null, denEntry = null;
      if (this.useGlyphCache) {
        numW = this._measureGlyphRunWidth(numStr, fontPx);
        denW = this._measureGlyphRunWidth(denStr, fontPx);
      } else {
        numEntry = this._createTightDigitTexture(numStr, fontPx, 0, this._noteTextHex());
        denEntry = this._createTightDigitTexture(denStr, fontPx, 0, this._noteTextHex());
        numW = (numEntry && numEntry.wCss) ? numEntry.wCss : 0;
        denW = (denEntry && denEntry.wCss) ? denEntry.wCss : 0;
      }

      // Divider geometry centered within the circle, sized to max of content widths
      const contentMax = Math.max(numW, denW);
      const dividerW = Math.max(6.0, contentMax + 2.0);
      const leftDiv = localCX - dividerW * 0.5;

      const thicknessPx = Math.max(1, Math.round(fontPx * 0.12));
      const dividerY = Math.floor(localCY - thicknessPx * 0.5) + 0.5;

      // Inner circular mask radius (inside the grey border)
      const borderPxIn = (this.xScalePxPerWU || 1.0);
      const innerR = 0.5 * minDim - borderPxIn;

      // 1) Divider line, clipped to inner circle
      if (this.solidCssCircMaskProgram && this.octaveLineVAO && this.octaveLinePosSizeBuffer) {
        gl.useProgram(this.solidCssCircMaskProgram);
        const U = (this._uniforms && this._uniforms.solidCssCircMask) ? this._uniforms.solidCssCircMask : null;
        const uVP = U ? U.u_viewport : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_viewport');
        const uZ  = U ? U.u_z        : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_z');
        const uCol= U ? U.u_color    : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_color');
        const uCtr= U ? U.u_circleCenter      : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_circleCenter');
        const uRad= U ? U.u_circleRadiusInner : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_circleRadiusInner');
        if (uVP) gl.uniform2f(uVP, vpW, vpH);
        if (uZ)  gl.uniform1f(uZ, -0.00001);
        { const tcTxt = this._noteTextRgba(); if (uCol) gl.uniform4f(uCol, tcTxt[0], tcTxt[1], tcTxt[2], 1.0); }
        if (uCtr)gl.uniform2f(uCtr, localCX, localCY);
        if (uRad)gl.uniform1f(uRad, innerR);

        gl.bindVertexArray(this.octaveLineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([leftDiv, dividerY, dividerW, thicknessPx]), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        gl.bindVertexArray(null);
      }

      // 2) Numerator/Denominator — masked to inner circle
      if (this.useGlyphCache && this.textCircMaskProgram && this.textVAO && this.textPosSizeBuffer) {
        // PMA for glyph textures; render above geometry
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);

        const sxNum = (numW > dividerW) ? (dividerW / Math.max(1, numW)) : 1.0;
        const sxDen = (denW > dividerW) ? (dividerW / Math.max(1, denW)) : 1.0;
        const usedNumW = numW * sxNum;
        const usedDenW = denW * sxDen;
        const nx = leftDiv + Math.max(0, Math.round((dividerW - usedNumW) * 0.5));
        const dx = leftDiv + Math.max(0, Math.round((dividerW - usedDenW) * 0.5));

        const ascNum = (this._measureRunMetricsCanvas && this._measureRunMetricsCanvas(numStr, fontPx).ascent) || this._getRunAscent(numStr, fontPx);
        const ny = Math.round((dividerY - gapPx - ascNum) * 2.0) / 2.0;
        const dy = Math.round((dividerY + thicknessPx + gapPx) * 2.0) / 2.0;

        const prog = this.textCircMaskProgram;
        gl.useProgram(prog);
        const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
        const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(prog, 'u_viewport');
        const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(prog, 'u_tint');
        const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(prog, 'u_tex');
        const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(prog, 'u_z');
        const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(prog, 'u_circleCenter');
        const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(prog, 'u_circleRadiusInner');
        if (uVPtm) gl.uniform2f(uVPtm, vpW, vpH);
        { const tcTxt = this._noteTextRgba(); if (uTintm) gl.uniform4f(uTintm, tcTxt[0], tcTxt[1], tcTxt[2], 1); }
        if (uTexm) gl.uniform1i(uTexm, 0);
        if (uZtm)  gl.uniform1f(uZtm, -0.00001);
        if (uCtrT) gl.uniform2f(uCtrT, localCX, localCY);
        if (uRadT) gl.uniform1f(uRadT, innerR);

        // Draw numerator glyph-run
        {
          let penX = nx;
          for (let i = 0; i < numStr.length; i++) {
            const ch = numStr[i];
            const g = this._getGlyph(ch);
            if (!g || !g.tex) continue;
            const scale = Math.max(1e-6, fontPx / (g.basePx || 64));
            const w = g.wCss * scale * sxNum;
            const h = g.hCss * scale;
            const arr = new Float32Array([penX, ny, w, h]);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, g.tex);
            gl.bindVertexArray(this.textVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            penX += w;
          }
        }

        // Draw denominator glyph-run
        {
          let penX = dx;
          for (let i = 0; i < denStr.length; i++) {
            const ch = denStr[i];
            const g = this._getGlyph(ch);
            if (!g || !g.tex) continue;
            const scale = Math.max(1e-6, fontPx / (g.basePx || 64));
            const w = g.wCss * scale * sxDen;
            const h = g.hCss * scale;
            const arr = new Float32Array([penX, dy, w, h]);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, g.tex);
            gl.bindVertexArray(this.textVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            penX += w;
          }
        }

        // Restore defaults
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(true);
        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else if (this.textCircMaskProgram && numEntry && denEntry && this.textVAO && this.textPosSizeBuffer) {
        // Fallback: canvas textures masked to circle
        const numWfit = Math.min(numEntry.wCss || 0, dividerW);
        const denWfit = Math.min(denEntry.wCss || 0, dividerW);
        const nx = leftDiv + Math.max(0, Math.round((dividerW - numWfit) * 0.5));
        const dx = leftDiv + Math.max(0, Math.round((dividerW - denWfit) * 0.5));
        const ny = Math.round((dividerY - gapPx - (numEntry.ascent || fontPx)) * 2.0) / 2.0;
        const dy = Math.round((dividerY + thicknessPx + gapPx) * 2.0) / 2.0;

        gl.useProgram(this.textCircMaskProgram);
        const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
        const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(this.textCircMaskProgram, 'u_viewport');
        const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(this.textCircMaskProgram, 'u_tint');
        const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(this.textCircMaskProgram, 'u_tex');
        const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(this.textCircMaskProgram, 'u_z');
        const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleCenter');
        const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleRadiusInner');
        if (uVPtm) gl.uniform2f(uVPtm, vpW, vpH);
        if (uTintm)gl.uniform4f(uTintm, 1, 1, 1, 1);
        if (uTexm) gl.uniform1i(uTexm, 0);
        if (uZtm)  gl.uniform1f(uZtm, -0.00001);
        if (uCtrT) gl.uniform2f(uCtrT, localCX, localCY);
        if (uRadT) gl.uniform1f(uRadT, innerR);

        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);

        if (numEntry && numEntry.tex) {
          const arrNum = new Float32Array([nx, ny, numWfit, numEntry.hCss || fontPx]);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, numEntry.tex);
          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arrNum, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        }
        if (denEntry && denEntry.tex) {
          const arrDen = new Float32Array([dx, dy, denWfit, denEntry.hCss || fontPx]);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, denEntry.tex);
          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arrDen, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        }

        // Restore defaults
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(true);
        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    };

    // Render per-note overlays: [id] label, fraction, octave arrows, right pull tab
    proto._renderNoteOverlays = function () {
      const gl = this.gl;
      if (!gl || !this.canvas) return;
      const positions = this.posSize;
      if (!this.drawNoteOverlays || !this.instanceCount || !positions) return;

      const ranges = this._detailRanges;
      if (!ranges.length) {
        // Measure ids are appended later in the same glyph pass. Start that
        // list fresh so cached note labels cannot survive a zoom into overview.
        this._glyphRunsCache = null;
        this._atlasGlyphCache = null;
        this._deferredGlyphRuns = [];
        this._textRebuildThisFrame = false;
        return;
      }

      // Ensure instanced attribute 4 (region attrib used by tab/arrow/divider masks) is enabled.
      // Note body pass disables attrib 4 via _setAttr4Enabled(false); without re-enabling,
      // tab regions, octave backgrounds, and fraction divider bands will not render at idle.
      this._setAttr4Enabled(true);

      const rectCss = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      const m = this.matrix;
      const off = this.canvasOffset || { x: 0, y: 0 };

      const textProg = this.textProgram;
      const solidProg = this.solidCssProgram;

      if (!textProg || !this.textVAO || !this.textPosSizeBuffer) return;

      // The note-local overlay regions (pull tab, arrow columns) are a function of each note's
      // WIDTH and HEIGHT — not of where it sits. A move drag changes no note's width, so they
      // cannot have changed; only a resize can, and a resize bakes the anchor's new width into
      // posSize without bumping _posEpoch (it shifts the dependents via _dragOffsetX instead).
      // Keying on that width, rather than on "a drag happened", means a move drag no longer
      // recomputes N regions and re-uploads N*4 floats on every single pointermove — which is
      // what made dragging a note with thousands of dependents hitch.
      const dragAnchorIdx = (this._dragActive && this._dragAnchorIndex != null && this._dragAnchorIndex >= 0)
        ? (this._dragAnchorIndex | 0) : -1;
      const dragGeomSig = (dragAnchorIdx >= 0 && this.posSize && (dragAnchorIdx * 4 + 2) < this.posSize.length)
        ? (positions[dragAnchorIdx * 4 + 2] + (this._dragOffsetW || 0.0))
        : -1;

      // Batching flags
      const batchDividers = true;
      const batchSilenceRings = true;

      // Accumulator for divider regions (note-local CSS px, centered coords)
      let _dividerRegions = this._dividerRegions || null;
      let _anyDivider = this._anyDivider || false;

      // Accumulator for silence "erase bands" to cover DOM fraction bars when glonly=0
      // Note-local CSS px, centered coords (xLeft, xRight, yTop, yBottom)
      let _silenceEraseRegions = this._silenceEraseRegions || null;
      let _anySilenceErase = this._anySilenceErase || false;

      // Ensure region buffers match current instanceCount.
      // Fixes intermittent missing fraction divider bars on add/drop when the cached arrays
      // were smaller than the new instance count (writes past typed array length are ignored).
      {
        const neededLen = Math.max(0, (this.instanceCount | 0)) * 4;
        if (!_dividerRegions || _dividerRegions.length !== neededLen) {
          _dividerRegions = neededLen ? new Float32Array(neededLen) : null;
          _anyDivider = false; // must rebuild flags for the new buffer
        }
        if (this.enableSilenceEraseBands && (!_silenceEraseRegions || _silenceEraseRegions.length !== neededLen)) {
          _silenceEraseRegions = neededLen ? new Float32Array(neededLen) : null;
          _anySilenceErase = false; // must rebuild flags for the new buffer
        }
      }

      // Batch draw right pull tabs with rounded interior clip (SDF), depth-layered
      try {
        if (this.tabMaskProgram && this.rectVAO && this.rectInstanceTabRegionBuffer && this.instanceCount > 0) {
          const N = this.instanceCount;
          // Full rebuild only on view changes or buffer reallocation
          const needInitTabs =
            (this._lastTabEpoch !== this._viewEpoch) ||
            (this._lastTabPosEpoch !== this._posEpoch) ||
            (this._lastTabDragGeom !== dragGeomSig) ||
            (!this._tabRegions || this._tabRegions.length !== N * 4) ||
            (!this._tabInnerRegions || this._tabInnerRegions.length !== N * 4);

          if (needInitTabs) {
            // Reuse the existing arrays: this rebuilds on every pointermove of a drag, and
            // minting two Float32Array(N*4) per frame (plus two more for the arrows below) was
            // ~320KB/frame of garbage at 5k notes. That churn is what produced the occasional
            // multi-frame GC hitch when dragging a note with thousands of dependents. The loop
            // writes all four components for every instance, so there is nothing stale to carry.
            const regions = (this._tabRegions && this._tabRegions.length === N * 4)
              ? this._tabRegions : new Float32Array(N * 4);
            const innerRegions = (this._tabInnerRegions && this._tabInnerRegions.length === N * 4)
              ? this._tabInnerRegions : new Float32Array(N * 4);

            const borderCss = Math.max(1, Math.round(1.0 * (this.xScalePxPerWU || 1.0)));
            for (let range = 0; range < ranges.length; range += 2) for (let i = ranges[range]; i < ranges[range + 1]; i++) {
              const o = i * 4;
              const wCss = positions[o + 2] * (this.xScalePxPerWU || 1.0);
              const hCss = positions[o + 3] * (this.yScalePxPerWU || 1.0);

              const pad = Math.max(2, Math.round(hCss * 0.08));
              const tabWidth = Math.max(10, Math.round(hCss * (this._config?.overlays?.tabWidthFactor ?? 0.5)) - borderCss);
              const heX = 0.5 * wCss;
              const rightInner = heX - borderCss;
              const leftEdge = rightInner - tabWidth;

              // Full-height tab strip (clip to rounded interior in shader)
              regions[o + 0] = leftEdge;
              regions[o + 1] = rightInner;
              regions[o + 2] = -1e6;
              regions[o + 3] =  1e6;

              // Centered inner rectangle ("handle") inside the tab
              const innerBarW = Math.max(2, Math.round(hCss * (this._config?.overlays?.innerTabBarWidthFactor ?? 0.1)));
              const innerBarH = Math.max(8, Math.round(hCss * 0.5));
              const centerX = leftEdge + Math.max(0, tabWidth) * 0.5;
              innerRegions[o + 0] = centerX - innerBarW * 0.5;
              innerRegions[o + 1] = centerX + innerBarW * 0.5;
              innerRegions[o + 2] = -innerBarH * 0.5;
              innerRegions[o + 3] =  innerBarH * 0.5;
            }

            this._tabRegions = regions;
            this._tabInnerRegions = innerRegions;

            const glUp = this.gl;
            if (glUp) {
              glUp.bindVertexArray(this.rectVAO);
              glUp.bindBuffer(glUp.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
              this._uploadVisibleRegions(this._tabRegions);
              if (this.rectInstanceTabInnerBuffer) {
                glUp.bindBuffer(glUp.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
                this._uploadVisibleRegions(this._tabInnerRegions);
              }
              glUp.bindBuffer(glUp.ARRAY_BUFFER, null);
              glUp.bindVertexArray(null);
            }

            this._lastTabEpoch = this._viewEpoch;
            this._lastTabPosEpoch = this._posEpoch;
            this._lastTabDragGeom = dragGeomSig;
          } else if (this._dragOffsetW !== 0.0 && this._tabRegions && this._tabInnerRegions && this._dragFlags) {
            // Resize preview: update only flagged instances to avoid O(N) work every frame
            const borderCss = Math.max(1, Math.round(1.0 * (this.xScalePxPerWU || 1.0)));
            const Nloc = this.instanceCount;
            for (let range = 0; range < ranges.length; range += 2) for (let i = ranges[range]; i < ranges[range + 1]; i++) {
              if (this._dragFlags[i] !== 1.0) continue;
              const o = i * 4;
              const wCss = positions[o + 2] * (this.xScalePxPerWU || 1.0);
              const hCss = positions[o + 3] * (this.yScalePxPerWU || 1.0);

              const tabWidth = Math.max(10, Math.round(hCss * 0.5) - borderCss);
              const heX = 0.5 * wCss;
              const rightInner = heX - borderCss;
              const leftEdge = rightInner - tabWidth;

              this._tabRegions[o + 0] = leftEdge;
              this._tabRegions[o + 1] = rightInner;
              this._tabRegions[o + 2] = -1e6;
              this._tabRegions[o + 3] =  1e6;

              const innerBarW = Math.max(2, Math.round(hCss * 0.1));
              const innerBarH = Math.max(8, Math.round(hCss * 0.5));
              const centerX = leftEdge + Math.max(0, tabWidth) * 0.5;
              this._tabInnerRegions[o + 0] = centerX - innerBarW * 0.5;
              this._tabInnerRegions[o + 1] = centerX + innerBarW * 0.5;
              this._tabInnerRegions[o + 2] = -innerBarH * 0.5;
              this._tabInnerRegions[o + 3] =  innerBarH * 0.5;
            }

            const glUp = this.gl;
            if (glUp) {
              glUp.bindVertexArray(this.rectVAO);
              glUp.bindBuffer(glUp.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
              this._uploadVisibleRegions(this._tabRegions);
              if (this.rectInstanceTabInnerBuffer) {
                glUp.bindBuffer(glUp.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
                this._uploadVisibleRegions(this._tabInnerRegions);
              }
              glUp.bindBuffer(glUp.ARRAY_BUFFER, null);
              glUp.bindVertexArray(null);
            }
          }

          
          gl.useProgram(this.tabMaskProgram);
          const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
          const uMat = Utb ? Utb.u_matrix      : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
          const uVP  = Utb ? Utb.u_viewport    : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
          const uOff = Utb ? Utb.u_offset      : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
          const uCR  = Utb ? Utb.u_cornerRadius: gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
          const uBW  = Utb ? Utb.u_borderWidth : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
          const uCol = Utb ? Utb.u_color       : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
          const uBias= Utb ? Utb.u_clipBias    : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');
          const uLB  = Utb ? Utb.u_layerBase   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
          const uLS  = Utb ? Utb.u_layerStep   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
          const uSC  = Utb ? Utb.u_scale       : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
          { const bw = (this._config?.note?.borderPxAtZoom1 ?? 1.0); if (uBW)  gl.uniform1f(uBW, bw * (this.xScalePxPerWU || 1.0)); }
          if (uLB)  gl.uniform1f(uLB, 1.0);
          if (uLS)  gl.uniform1f(uLS, -1.0 / Math.max(1, this.instanceCount + 5));
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          // Drag/resize offset for instanced overlays
          {
            const uDrag = Utb ? Utb.u_dragOffset : gl.getUniformLocation(this.tabMaskProgram, 'u_dragOffset');
            if (uDrag) gl.uniform2f(uDrag, this._dragOffsetX || 0.0, this._dragOffsetW || 0.0);
          }
          // No bias for pull-tab (exact interior clip)
          if (uBias) gl.uniform1f(uBias, 0.0);

          // Solid geometry blend (non-premultiplied)
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);

          gl.bindVertexArray(this.rectVAO);

          // Pass 1: tab strip (light)
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.15);
          // Point attribute 4 to primary buffer, then draw
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          this._drawVisibleInstances(this.tabMaskProgram, this.rectInstanceTabRegionBuffer);

          // Pass 2: inner vertical bar (stronger)
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.6);
          // Point attribute 4 to inner buffer, then draw
          if (this.rectInstanceTabInnerBuffer) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
            gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          } else {
            // Fallback: re-upload inner to primary buffer if secondary not available
            gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
            this._uploadVisibleRegions(this._tabInnerRegions);
          }
          this._drawVisibleInstances(this.tabMaskProgram, this.rectInstanceTabInnerBuffer || this.rectInstanceTabRegionBuffer);

          // Restore attribute 4 to primary buffer for consistency
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);

          gl.bindVertexArray(null);
          // Restore premultiplied for subsequent text draws
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }
      } catch {}

      // Common uniforms for text rendering
      gl.useProgram(textProg);
      const Ut = (this._uniforms && this._uniforms.text) ? this._uniforms.text : null;
      const uVPt = Ut ? Ut.u_viewport : gl.getUniformLocation(textProg, 'u_viewport');
      const uTint = Ut ? Ut.u_tint     : gl.getUniformLocation(textProg, 'u_tint');
      const uTex  = Ut ? Ut.u_tex      : gl.getUniformLocation(textProg, 'u_tex');
      if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
      if (uTint) gl.uniform4f(uTint, 1, 1, 1, 1);
      if (uTex)  gl.uniform1i(uTex, 0);

      // Defer all text sprites (IDs, silence text) to draw AFTER any rings for correct z-order across notes
      this._deferredTextSprites = []; // array of { tex, x, y, w, h, layerZ }
      // Defer glyph-run draws (IDs, digits, arrows). Prefer cached runs if scene text unchanged and view epoch stable.
      const reuseRuns = !!(this.useGlyphAtlas && this.useGlyphCache && this._glyphRunsCache && !this._textDirty && this._lastTextViewEpoch === this._viewEpoch && this._lastTextPosEpoch === this._posEpoch && this._lastTextDragEpoch === this._dragEpoch);
      if (reuseRuns) {
        // Hand the cached list back BY REFERENCE rather than copying it. Every push site
        // is guarded by this same reuse condition, so a reuse frame cannot mutate it, and
        // keeping the array identity stable is what lets _flushGlyphRunsAtlas recognise
        // the run list as unchanged and skip re-expanding + re-uploading every glyph.
        this._deferredGlyphRuns = this._glyphRunsCache!;
        this._textRebuildThisFrame = false;
      } else {
        this._deferredGlyphRuns = [];   // will build below and cache post-flush
        this._textRebuildThisFrame = true;
      }

      // Use premultiplied-alpha-appropriate blending for text
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // Depth testing for overlays; overlays test depth but do not write it
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      // Depth layer uniforms
      const uZText = gl.getUniformLocation(textProg, 'u_z');
      const uZSolid = solidProg ? gl.getUniformLocation(solidProg, 'u_z') : null;
      const baseZ = 1.0;
      const stepZ = -1.0 / Math.max(1, this.instanceCount + 5);

      // Batched octave arrow backgrounds (upper/lower halves), clipped to inner rounded-rect
      try {
        if (this.drawNoteArrows && this.tabMaskProgram && this.rectVAO && this.rectInstanceArrowRegionBuffer && this.instanceCount > 0) {
          const N = this.instanceCount;
          const needUpdateArrows =
            (this._lastArrowEpoch !== this._viewEpoch) ||
            (this._lastArrowPosEpoch !== this._posEpoch) ||
            (this._lastArrowDragGeom !== dragGeomSig) ||
            (!this._arrowUpRegions || this._arrowUpRegions.length !== N * 4) ||
            (!this._arrowDownRegions || this._arrowDownRegions.length !== N * 4);

          if (needUpdateArrows) {
            // Reuse — see the tab-region comment above. Both the silence branch and the normal
            // branch write all four components per instance, so no stale data survives.
            if (!this._arrowUpRegions || this._arrowUpRegions.length !== N * 4) {
              this._arrowUpRegions = new Float32Array(N * 4);
            }
            if (!this._arrowDownRegions || this._arrowDownRegions.length !== N * 4) {
              this._arrowDownRegions = new Float32Array(N * 4);
            }

            const borderCssExact = (this.xScalePxPerWU || 1.0);
            const epsCss = 0.5;

            for (let range = 0; range < ranges.length; range += 2) for (let i = ranges[range]; i < ranges[range + 1]; i++) {
              const o = i * 4;
              const wCss = positions[o + 2] * (this.xScalePxPerWU || 1.0);
              const hCss = positions[o + 3] * (this.yScalePxPerWU || 1.0);
              const isSilence = !!(this._instanceFlags && this._instanceFlags[i] === 1.0);

              if (isSilence || wCss <= 0 || hCss <= 0) {
                // Degenerate region (xLeft > xRight) to fully discard in shader
                this._arrowUpRegions[o + 0] = 1.0; this._arrowUpRegions[o + 1] = 0.0;
                this._arrowUpRegions[o + 2] = 0.0; this._arrowUpRegions[o + 3] = 0.0;
                this._arrowDownRegions[o + 0] = 1.0; this._arrowDownRegions[o + 1] = 0.0;
                this._arrowDownRegions[o + 2] = 0.0; this._arrowDownRegions[o + 3] = 0.0;
                continue;
              }

              const heX = 0.5 * wCss;
              const leftInner = -heX + borderCssExact;
              // Match DOM: width proportional to note height, minus 1px border; min 10px; >=4px safety
              const targetBgWidth = Math.max(10, Math.round(hCss * (this._config?.overlays?.arrowColumnWidthFactor ?? 0.5) - borderCssExact));
              const bgWidth = Math.max(4, targetBgWidth);
              const xLeft = leftInner - 0.75;  // slight overreach to avoid left-edge seam; clipped by inner rounded-rect
              const xRight = leftInner + bgWidth;

              // Use note-local centered Y; split at 0 with small epsilon
              const yTopAll = -1e6, yBottomAll = 1e6, yMidLocal = 0.0;

              // Upper half
              this._arrowUpRegions[o + 0] = xLeft;
              this._arrowUpRegions[o + 1] = xRight;
              this._arrowUpRegions[o + 2] = yTopAll;
              this._arrowUpRegions[o + 3] = yMidLocal - epsCss;

              // Lower half
              this._arrowDownRegions[o + 0] = xLeft;
              this._arrowDownRegions[o + 1] = xRight;
              this._arrowDownRegions[o + 2] = yMidLocal + epsCss;
              this._arrowDownRegions[o + 3] = yBottomAll;
            }

            this._lastArrowEpoch = this._viewEpoch;
            this._lastArrowPosEpoch = this._posEpoch;
            this._lastArrowDragGeom = dragGeomSig;
            // The regions were just recomputed, so the GPU copy is stale, full stop.
            // Deriving the upload from an epoch PAIR was the bug: _lastArrowEpoch is
            // stamped with _viewEpoch, which does not change during a drag, so a rebuild
            // triggered by the drag restored the very same value the last upload was
            // stamped with and the upload was skipped — leaving the GPU with the note's
            // ORIGINAL arrow geometry while the body stretched.
            this._arrowRegionsDirty = true;
          }

          const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
          const uMat = Utb ? Utb.u_matrix      : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
          const uVP  = Utb ? Utb.u_viewport    : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
          const uOff = Utb ? Utb.u_offset      : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
          const uCR  = Utb ? Utb.u_cornerRadius: gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
          const uBW  = Utb ? Utb.u_borderWidth : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
          const uCol = Utb ? Utb.u_color       : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
          const uBias= Utb ? Utb.u_clipBias    : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');
          const uLB  = Utb ? Utb.u_layerBase   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
          const uLS  = Utb ? Utb.u_layerStep   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
          const uSC  = Utb ? Utb.u_scale       : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');

          gl.useProgram(this.tabMaskProgram);
          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
          { const bw = (this._config?.note?.borderPxAtZoom1 ?? 1.0); if (uBW)  gl.uniform1f(uBW, bw * (this.xScalePxPerWU || 1.0)); }
          if (uLB)  gl.uniform1f(uLB, 1.0);
          if (uLS)  gl.uniform1f(uLS, stepZ);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          {
            const uDrag = Utb ? Utb.u_dragOffset : gl.getUniformLocation(this.tabMaskProgram, 'u_dragOffset');
            if (uDrag) gl.uniform2f(uDrag, this._dragOffsetX || 0.0, this._dragOffsetW || 0.0);
          }
          if (uBias) gl.uniform1f(uBias, 0.35); // small inward bias to ensure no AA gap at inner border

          // Solid geometry blend (non-PMA)
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);
          gl.disable(gl.SCISSOR_TEST);

          gl.bindVertexArray(this.rectVAO);

          // Upload arrow regions only when data changed (view epoch or recompute).
          // Each half has its own buffer, so a skipped upload leaves BOTH halves holding
          // their own correct regions — see the buffer creation comment.
          const mustUploadArrow = !!this._arrowRegionsDirty;

          // Upper half (lighter)
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.15);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowRegionBuffer);
          if (mustUploadArrow) {
            this._uploadVisibleRegions(this._arrowUpRegions);
          }
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          this._drawVisibleInstances(this.tabMaskProgram, this.rectInstanceArrowRegionBuffer);

          // Lower half (same tint to avoid seam brightness mismatch)
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.15);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowDownRegionBuffer);
          if (mustUploadArrow) {
            this._uploadVisibleRegions(this._arrowDownRegions);
          }
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          this._drawVisibleInstances(this.tabMaskProgram, this.rectInstanceArrowDownRegionBuffer);

          // Mark successful upload epoch to prevent redundant buffer traffic next frames
          if (mustUploadArrow) {
            this._arrowRegionsDirty = false;
          }

          // Restore attribute 4 to primary tab region buffer for subsequent passes
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);

          gl.bindVertexArray(null);
          // Restore PMA for text afterwards
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }
      } catch {}
// Hover emphasis overlays for subregions (increase background opacity on hover)
try {
  const hs = this._hoverSub;
  if (hs && this._noteIdToIndex && this.tabMaskProgram && this.rectVAO) {
    const idx = this._noteIdToIndex.get(Number(hs.id));
    if (idx != null && idx >= 0 && idx < this.instanceCount && this.posSize) {
      const base = idx * 4;
      // Build single-instance posSize for the hovered note, applying drag preview offsets
      // manually for moving notes (anchor already baked into CPU posSize).
      let xwH = positions[base + 0];
      let ywH = positions[base + 1];
      let wwH = positions[base + 2];
      let hhH = positions[base + 3];
      const movingHover = !!(this._dragActive && this._dragFlags && this._dragFlags[idx] === 1.0 && !(this._dragAnchorIndex != null && idx === (this._dragAnchorIndex | 0)));
      if (movingHover) {
        xwH += (this._dragOffsetX || 0.0);
        wwH += (this._dragOffsetW || 0.0);
      }
      const arrPos = new Float32Array([ xwH, ywH, wwH, hhH ]);

      
      gl.useProgram(this.tabMaskProgram);
      const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
      const uMat = Utb ? Utb.u_matrix       : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
      const uVP  = Utb ? Utb.u_viewport     : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
      const uOff = Utb ? Utb.u_offset       : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
      const uCR  = Utb ? Utb.u_cornerRadius : gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
      const uBW  = Utb ? Utb.u_borderWidth  : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
      const uCol = Utb ? Utb.u_color        : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
      const uLB  = Utb ? Utb.u_layerBase    : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
      const uLS  = Utb ? Utb.u_layerStep    : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
      const uSC  = Utb ? Utb.u_scale        : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');
      const uBias= Utb ? Utb.u_clipBias     : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');

      if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
      if (uVP)  gl.uniform2f(uVP, vpW, vpH);
      if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
      { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
      { const bw = (this._config?.note?.borderPxAtZoom1 ?? 1.0); if (uBW)  gl.uniform1f(uBW, bw * (this.xScalePxPerWU || 1.0)); }
      if (uLB)  gl.uniform1f(uLB, 1.0);
      const stepZHover = -1.0 / Math.max(1, this.instanceCount + 5);
      if (uLS)  gl.uniform1f(uLS, stepZHover);
      if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
      // For single-instance hover overlay, avoid double-applying drag offset
      {
        const uDrag = Utb ? Utb.u_dragOffset : gl.getUniformLocation(this.tabMaskProgram, 'u_dragOffset');
        if (uDrag) gl.uniform2f(uDrag, 0.0, 0.0);
      }

      // PMA off for solid geometry; force-on-top by disabling depth test for hover overlay
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);

      gl.bindVertexArray(this.rectVAO);
      if (!this._singlePosSizeBuffer) {
        this._singlePosSizeBuffer = gl.createBuffer();
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, arrPos, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      const drawRegion = (regionRect: Float32Array<ArrayBuffer> | null, color: number[], bias: number) => {
        if (!regionRect) return;
        if (uBias) gl.uniform1f(uBias, bias);
        if (uCol)  gl.uniform4f(uCol, color[0], color[1], color[2], color[3]);
        // Dedicated scratch buffer. This single-instance hover overlay used to borrow
        // rectInstanceArrowRegionBuffer and bufferData a lone 4-float rect into it, which
        // silently SHRANK the shared arrow-region buffer to 16 bytes. The next frame's
        // N-instance upper-arrow draw then read past the end and the whole upper arrow band
        // disappeared. It only ever looked fine because the arrow regions happened to be
        // re-uploaded every single frame, which repaired the damage before anyone saw it.
        if (!this._hoverRegionScratchBuffer) this._hoverRegionScratchBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._hoverRegionScratchBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, regionRect, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
      };

      const o = idx * 4;
      if (hs.region === 'tab') {
        if (this._tabRegions && this._tabInnerRegions) {
          const region = new Float32Array([
            this._tabRegions[o + 0], this._tabRegions[o + 1], this._tabRegions[o + 2], this._tabRegions[o + 3]
          ]);
          const inner  = new Float32Array([
            this._tabInnerRegions[o + 0], this._tabInnerRegions[o + 1], this._tabInnerRegions[o + 2], this._tabInnerRegions[o + 3]
          ]);
          drawRegion(region, [1.0, 1.0, 1.0, 0.30], 0.0);
          drawRegion(inner,  [1.0, 1.0, 1.0, 0.90], 0.0);
        }
      } else if (hs.region === 'octaveUp' || hs.region === 'octaveDown') {
        if (this._arrowUpRegions && this._arrowDownRegions) {
          const src = (hs.region === 'octaveUp') ? this._arrowUpRegions : this._arrowDownRegions;
          const region = new Float32Array([
            src[o + 0], src[o + 1], src[o + 2], src[o + 3]
          ]);
          // Stronger alpha on hover to make the emphasis clearly visible
          drawRegion(region, [1.0, 1.0, 1.0, 0.30], 0.35);
        }
      }

      // Restore attribute pointers to instanced buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.depthMask(true);
      // Re-enable depth test for subsequent draws
      gl.enable(gl.DEPTH_TEST);
    }
  }
} catch {}

      // The cached run list already contains all note labels. Appending again
      // would retain a duplicate set on every playhead or hover redraw.
      if (!reuseRuns) {
      // Viewport cull bounds. Every overlay this loop emits for a note — pull tab, octave
      // arrows, fraction divider, silence band, and all of its text runs — is scissored to
      // that note's own rect, so a note whose rect lies entirely off-canvas cannot produce
      // a single pixel and every bit of work for it is wasted. This is why the cull is
      // exact rather than an approximation, and why the picture stays pixel-identical.
      // Without it, cost scaled with the size of the MODULE; with it, it scales with what
      // is actually on screen, which is what makes 100k notes tractable.
      // Moving notes are offset on the GPU during a drag (u_dragOffset / u_dragCssX) instead
      // of in posSize, so widen the horizontal test by that offset — otherwise a note dragged
      // in from off-screen would arrive with no overlays. Drags only shift x/width; frequency
      // edits go through sync(), so the vertical bound needs no such slack.
      const cullPadX = 2 + (this._dragActive
        ? Math.abs((m[0] || 0) * (this._dragOffsetX || 0)) + Math.abs((m[0] || 0) * (this._dragOffsetW || 0))
        : 0);
      for (let range = 0; range < ranges.length; range += 2) for (let i = ranges[range]; i < ranges[range + 1]; i++) {
        const o = i * 4;
        const so = i * 2;

        const xw = positions[o + 0];
        const yw = positions[o + 1];
        // Derive current CSS px from world size so overlays track zoom precisely
        const wCss = positions[o + 2] * (this.xScalePxPerWU || 1.0);
        const hCss = positions[o + 3] * (this.yScalePxPerWU || 1.0);

        // world (xw,yw) -> page CSS px (sx,sy) -> canvas-local CSS px (left, top)
        const sx = m[0] * xw + m[3] * yw + m[6];
        const sy = m[1] * xw + m[4] * yw + m[7];
        const left = sx - off.x;
        const top  = sy - off.y;

        if (left + wCss + cullPadX < 0 || left - cullPadX > vpW ||
            top + hCss + 2 < 0 || top - 2 > vpH) continue;

        // Rounded-corner radius in CSS px (matches note body shader) and per-note scissor to clip overlays
        const cornerRadiusCss = Math.min(((this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0) * (this.xScalePxPerWU || 1.0)), wCss * 0.5, hCss * 0.5);
        const dpr = this.devicePixelRatio || 1;
        // Use the exact (non-rounded) border width for shader-aligned interior clipping
        const borderCssExact = (this._config?.note?.borderPxAtZoom1 ?? 1.0) * (this.xScalePxPerWU || 1.0);
        // Use integer px only for scissor rectangle to match rasterization grid
        const borderCssInt = Math.max(1, Math.round(borderCssExact));
        const scLeftCss = left + borderCssInt;
        const scTopCss = top + borderCssInt;
        const scWidthCss = Math.max(0, wCss - 2 * borderCssInt);
        const scHeightCss = Math.max(0, hCss - 2 * borderCssInt);
        // Clip handled in-shader via per-fragment clip rect; no per-note scissor.

        // Note interior rounded-rect parameters in screen-space for SDF text masking (IDs, etc.)
        const rrCx = left + 0.5 * wCss;
        const rrCy = top  + 0.5 * hCss;
        const rrHx = Math.max(0, 0.5 * wCss - borderCssExact);
        const rrHy = Math.max(0, 0.5 * hCss - borderCssExact);
        const rrR  = Math.max(0, cornerRadiusCss - borderCssExact - 0.35);

        // Dynamic sizes proportional to note height (zoom-aware)
        const pad = Math.max(2, Math.round(hCss * 0.08));
        // Fixed strip widths (match current eighth-note sizing at all lengths), minus one border width
        const arrowsWidth = Math.max(10, Math.round(hCss * 0.5) - borderCssInt);
        const tabWidthBase = Math.max(10, Math.round(hCss * 0.5) - borderCssInt);
        const tabWidth = tabWidthBase;
        const innerBarW = Math.max(2, Math.round(hCss * 0.1));
        const innerBarH = Math.max(8, Math.round(hCss * 0.5));

        // Content area for fraction and id label.
        // The octave-arrow column is only reserved when the arrows are actually being drawn:
        // with arrows turned off there is nothing in that strip, so the id and fraction reclaim
        // it instead of sitting behind an empty gutter. Note this keys off the drawNoteArrows
        // setting, NOT off isSilence — a silence note still reserves the column while arrows are
        // enabled, so it stays aligned with its neighbours (legacy parity).
        const isSilence = (this._noteFracNumStrs && this._noteFracNumStrs[i] === 'silence');
        const arrowsColWidth = this.drawNoteArrows ? arrowsWidth : 0;
        const contentLeft = (left + arrowsColWidth + pad);
        const contentRight = left + wCss - tabWidth - pad;
        const contentWidth = Math.max(1, contentRight - contentLeft);

        // Depth layer for this note (match body instance ordering)
        const layerZ = baseZ + i * stepZ;

        // 1) Note ID label [N] near top-left (orange, zoom-aware)
        const id = this._instanceNoteIds ? (this._instanceNoteIds[i] | 0) : i;
        try {
          const idLabel = `[${id}]`;
          const idFont = this.useGlyphCache
            ? Math.max(6, Math.round(hCss * (this._config?.overlays?.idLabelFontFactor ?? 0.12)))
            : this._clampFontPx(Math.max(6, Math.round(hCss * (this._config?.overlays?.idLabelFontFactor ?? 0.12)))); // smaller ID label
          const leftShift = Math.max(1, Math.round(hCss * 0.04)); // nudge slightly left

          // Measure run width to constrain within content area and avoid overflow on very narrow notes
          const idRunW = this._measureGlyphRunWidth(idLabel, idFont);
          const maxX = contentRight - idRunW;
          const ix = Math.min(
            Math.max(scLeftCss + leftShift, contentLeft),
            Math.max(contentLeft, maxX)
          );
          const iy = top + Math.max(1, Math.round(hCss * 0.05));

          if (this.useGlyphCache) {
            this._deferredGlyphRuns.push({
              text: idLabel, noteId: id, x: ix, y: iy, fontPx: idFont, color: this._accentRgba(), layerZ,
              scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
              rrCx, rrCy, rrHx, rrHy, rrR
            });
          } else {
            const idEntry = this._createStyledTextTexture(idLabel, idFont, 0, this._accentHex(), 'rgba(0,0,0,0)', 0);
            if (idEntry && idEntry.tex) {
              this._deferredTextSprites.push({
                tex: idEntry.tex,
                x: ix, y: iy, w: idEntry.wCss, h: idEntry.hCss,
                layerZ,
                scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss
              });
            }
          }
        } catch {}

        // 2) Fraction (numerator/denominator) and divider line (scale with height)
        try {
          const numStr = this._noteFracNumStrs ? this._noteFracNumStrs[i] : null;
          const denStr = this._noteFracDenStrs ? this._noteFracDenStrs[i] : null;
          const isSilence = (numStr === 'silence');
          const isLine = (denStr === LINE_LABEL);

          if (isLine) {
            // A tempered note: its exact power on one line (2^(7/12)), after the arrows,
            // squeezed horizontally like the silence text when the note is short
            const fontPx = this.useGlyphCache ? Math.max(5, Math.round(hCss * 0.26)) : this._clampFontPx(Math.max(5, Math.round(hCss * 0.26)));
            const text = String(numStr);
            const sLeft = contentLeft;
            const sWidth = Math.max(1, contentRight - sLeft);
            const runW = this._measureGlyphRunWidth(text, fontPx);
            const runH = this._getRunHeight(text, fontPx);
            const sx = runW > 0 ? Math.min(1.0, sWidth / runW) : 1.0;
            const ny = Math.round((top + hCss * 0.5 - runH * 0.5) * 2.0) / 2.0;
            this._deferredGlyphRuns.push({
              text, noteId: id, x: sLeft, y: ny, fontPx, color: this._noteTextRgba(), layerZ, scaleX: sx,
              scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
              rrCx, rrCy, rrHx, rrHy, rrR
            });
            // No fraction bar for a one-line label
            if (!_dividerRegions) _dividerRegions = new Float32Array(this.instanceCount * 4);
            const oDiv = i * 4;
            _dividerRegions[oDiv + 0] = 1.0;
            _dividerRegions[oDiv + 1] = 0.0;
            _dividerRegions[oDiv + 2] = 0.0;
            _dividerRegions[oDiv + 3] = 0.0;
          } else if (isSilence) {
            // Silence: draw only "silence" text, left-aligned; HORIZONTAL scaling only (no vertical scaling).
            // Use full left content area (no octave arrows for silences) while keeping ID placement unchanged.
            const fontPx = this.useGlyphCache ? Math.max(5, Math.round(hCss * 0.26)) : this._clampFontPx(Math.max(5, Math.round(hCss * 0.26)));
            {
              const labelSil = 'silence';
              const sLeft = left + pad;
              const sRight = contentRight;
              const sWidth = Math.max(1, sRight - sLeft);
              const runW = this._measureGlyphRunWidth(labelSil, fontPx);
              const runH = this._getRunHeight(labelSil, fontPx);
              const sx = runW > 0 ? Math.min(1.0, sWidth / runW) : 1.0;
              const nx = sLeft;
              const ny = Math.round((top + hCss * 0.5 - runH * 0.5) * 2.0) / 2.0;
              this._deferredGlyphRuns.push({
                text: labelSil, noteId: id, x: nx, y: ny, fontPx, color: this._noteTextRgba(), layerZ, scaleX: sx,
                scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                rrCx, rrCy, rrHx, rrHy, rrR
              });
              // Ensure no divider is drawn for silence (defensive: zero/degenerate region for this instance)
              {
                if (!_dividerRegions) _dividerRegions = new Float32Array(this.instanceCount * 4);
                const oDiv = i * 4;
                // xLeft > xRight forces a discard in shader band test
                _dividerRegions[oDiv + 0] = 1.0;
                _dividerRegions[oDiv + 1] = 0.0;
                _dividerRegions[oDiv + 2] = 0.0;
                _dividerRegions[oDiv + 3] = 0.0;
              }
              // When GL overlay is mixed with DOM (glonly=0), the DOM may still draw a fraction bar on selection.
              // Draw a small interior-colored band over the midline for silence notes to cover any DOM bar.
              if (this.enableSilenceEraseBands) {
                if (!_silenceEraseRegions) _silenceEraseRegions = new Float32Array(this.instanceCount * 4);
                const heX_local = 0.5 * wCss;
                const xL_local = -heX_local + (arrowsColWidth + pad);
                const xR_local =  heX_local - (tabWidth + pad);
                // Use a thin band around the vertical center; thickness ~1–2 CSS px depending on zoom
                const thicknessCss = Math.max(1, Math.round((this.xScalePxPerWU || 1.0)));
                const yT_local = -thicknessCss * 0.5;
                const yB_local =  thicknessCss * 0.5;
                const oErase = i * 4;
                _silenceEraseRegions[oErase + 0] = xL_local;
                _silenceEraseRegions[oErase + 1] = xR_local;
                _silenceEraseRegions[oErase + 2] = yT_local;
                _silenceEraseRegions[oErase + 3] = yB_local;
                _anySilenceErase = true;
              }
            }
          } else if (numStr != null && denStr != null) {
            const fontPx = this.useGlyphCache
              ? Math.max(5, Math.round(hCss * (this._config?.overlays?.fractionFontFactor ?? 0.26)))
              : this._clampFontPx(Math.max(5, Math.round(hCss * (this._config?.overlays?.fractionFontFactor ?? 0.26)))); // slightly larger fraction numerals
            const gapPx  = Math.max(1, Math.round(fontPx * 0.08));

            // ≈ before the fraction: the value is approximate, or the exact fraction is too long
            // to show and this one is rounded (a tempered note has a one-line label instead)
            const isCorrupted = !!(this._noteLabelApprox && this._noteLabelApprox[i] === 1);
            const approxSymbol = '≈';
            const approxW = isCorrupted ? this._measureGlyphRunWidth(approxSymbol, fontPx) : 0;
            const approxGap = isCorrupted ? Math.max(1, Math.round(fontPx * 0.1)) : 0;
            const approxOffset = approxW + approxGap;

            // Compute divider metrics once; reuse for bar and text centering
            const centerY = top + hCss * 0.5;
            const thicknessCss = Math.max(1, Math.round(fontPx * (this._config?.overlays?.dividerThicknessFactor ?? 0.12))); // divider thickness via config
            const yTopDiv = Math.floor(centerY - thicknessCss * 0.5) + 0.5;
            const xLine = contentLeft + approxOffset;

            if (this.useGlyphCache) {
              // Measure glyph-run widths
              const numWforDiv = this._measureGlyphRunWidth(String(numStr), fontPx);
              const denWforDiv = this._measureGlyphRunWidth(String(denStr), fontPx);
              const contentMax = Math.max(numWforDiv, denWforDiv);
              const extra = 2.0; // small padding
              const dividerW = Math.max(6.0, Math.min(contentWidth - approxOffset, contentMax + extra));

              // Defer divider region for batched pass
              {
                if (!_dividerRegions) _dividerRegions = new Float32Array(this.instanceCount * 4);
                const heX_local = 0.5 * wCss;
                const xL_local = -heX_local + (arrowsColWidth + pad) + approxOffset;
                const xR_local = xL_local + dividerW;
                const yT_local = -thicknessCss * 0.5;
                const yB_local =  thicknessCss * 0.5;
                const oDiv = i * 4;
                _dividerRegions[oDiv + 0] = xL_local;
                _dividerRegions[oDiv + 1] = xR_local;
                _dividerRegions[oDiv + 2] = yT_local;
                _dividerRegions[oDiv + 3] = yB_local;
                _anyDivider = true;
              }

              // Prepare positions using baseline ascent for numerator and horizontal compression
              const ascNum = (this._measureRunMetricsCanvas && this._measureRunMetricsCanvas(String(numStr), fontPx).ascent) || this._getRunAscent(String(numStr), fontPx);
              const runHDen = this._getRunHeight(String(denStr), fontPx);
              const sxNum = (numWforDiv > dividerW) ? (dividerW / Math.max(1, numWforDiv)) : 1.0;
              const sxDen = (denWforDiv > dividerW) ? (dividerW / Math.max(1, denWforDiv)) : 1.0;
              const usedNumW = numWforDiv * sxNum;
              const usedDenW = denWforDiv * sxDen;
              const nx = xLine + Math.max(0, Math.round((dividerW - usedNumW) * 0.5));
              const dx = xLine + Math.max(0, Math.round((dividerW - usedDenW) * 0.5));
              const numTop = Math.round((yTopDiv - gapPx - ascNum) * 2.0) / 2.0;
              const denTop = Math.round((yTopDiv + thicknessCss + gapPx) * 2.0) / 2.0;

              // Enqueue glyph runs with horizontal compression scaleX
              this._deferredGlyphRuns.push({
                text: String(numStr), noteId: id, x: nx, y: numTop, fontPx, color: this._noteTextRgba(), layerZ, scaleX: sxNum,
                scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                rrCx, rrCy, rrHx, rrHy, rrR
              });
              this._deferredGlyphRuns.push({
                text: String(denStr), noteId: id, x: dx, y: denTop, fontPx, color: this._noteTextRgba(), layerZ, scaleX: sxDen,
                scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                rrCx, rrCy, rrHx, rrHy, rrR
              });

              // Render ≈ symbol to the left of fraction, vertically centered
              if (isCorrupted) {
                const approxH = this._getRunHeight(approxSymbol, fontPx);
                const approxAsc = (this._measureRunMetricsCanvas && this._measureRunMetricsCanvas(approxSymbol, fontPx).ascent) || this._getRunAscent(approxSymbol, fontPx);
                const approxY = Math.round((centerY - approxAsc * 0.5) * 2.0) / 2.0;
                this._deferredGlyphRuns.push({
                  text: approxSymbol, noteId: id, x: contentLeft, y: approxY, fontPx, color: this._noteTextRgba(), layerZ, scaleX: 1.0,
                  scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                  rrCx, rrCy, rrHx, rrHy, rrR
                });
              }
            } else {
              const numEntry = this._createTightDigitTexture(String(numStr), fontPx, 0, this._noteTextHex());
              const denEntry = this._createTightDigitTexture(String(denStr), fontPx, 0, this._noteTextHex());

              const numWforDiv = (numEntry && numEntry.wCss) ? numEntry.wCss : 0;
              const denWforDiv = (denEntry && denEntry.wCss) ? denEntry.wCss : 0;
              const contentMax = Math.max(numWforDiv, denWforDiv);
              const extra = 2.0;
              const dividerW = Math.max(6.0, Math.min(contentWidth - approxOffset, contentMax + extra));

              // Defer divider region for batched pass
              {
                if (!_dividerRegions) _dividerRegions = new Float32Array(this.instanceCount * 4);
                const heX_local = 0.5 * wCss;
                const xL_local = -heX_local + (arrowsColWidth + pad) + approxOffset;
                const xR_local = xL_local + dividerW;
                const yT_local = -thicknessCss * 0.5;
                const yB_local =  thicknessCss * 0.5;
                const oDiv = i * 4;
                _dividerRegions[oDiv + 0] = xL_local;
                _dividerRegions[oDiv + 1] = xR_local;
                _dividerRegions[oDiv + 2] = yT_local;
                _dividerRegions[oDiv + 3] = yB_local;
                _anyDivider = true;
              }

              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.useProgram(textProg);
              if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
              if (uTint) gl.uniform4f(uTint, 1, 1, 1, 1);
              if (uZText) gl.uniform1f(uZText, layerZ);

              // Render ≈ symbol for corrupted notes (non-glyph-cache path)
              if (isCorrupted) {
                const approxEntry = this._createTightDigitTexture(approxSymbol, fontPx, 0, this._noteTextHex());
                if (approxEntry && approxEntry.tex) {
                  const approxAsc = (approxEntry && typeof approxEntry.ascent === 'number') ? approxEntry.ascent : (approxEntry ? approxEntry.hCss * 0.5 : 0);
                  const approxY = Math.round((centerY - approxAsc * 0.5) * 2.0) / 2.0;
                  const arrApprox = new Float32Array([contentLeft, approxY, approxEntry.wCss, approxEntry.hCss]);
                  gl.activeTexture(gl.TEXTURE0);
                  gl.bindTexture(gl.TEXTURE_2D, approxEntry.tex);
                  gl.bindVertexArray(this.textVAO);
                  gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                  gl.bufferData(gl.ARRAY_BUFFER, arrApprox, gl.DYNAMIC_DRAW);
                  gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
                }
              }

              if (numEntry && numEntry.tex) {
                const numW = Math.min(numEntry.wCss, dividerW);
                const nx = xLine + Math.max(0, Math.round((dividerW - numW) * 0.5));
                const asc = (numEntry && typeof numEntry.ascent === 'number') ? numEntry.ascent : (numEntry ? numEntry.hCss : 0);
                const ny = Math.round((yTopDiv - gapPx - asc) * 2.0) / 2.0;
                const arrNum = new Float32Array([nx, ny, numW, numEntry.hCss]);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, numEntry.tex);
                gl.bindVertexArray(this.textVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, arrNum, gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              }
              if (denEntry && denEntry.tex) {
                const denW = Math.min(denEntry.wCss, dividerW);
                const dx = xLine + Math.max(0, Math.round((dividerW - denW) * 0.5));
                const dy = Math.round((yTopDiv + thicknessCss + gapPx) * 2.0) / 2.0;
                const arrDen = new Float32Array([dx, dy, denW, denEntry.hCss]);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, denEntry.tex);
                gl.bindVertexArray(this.textVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, arrDen, gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              }
            }
          }
        } catch {}

        // 3) Octave change arrows (▲ and ▼) with split left backgrounds; arrows centered in their halves
        if (!isSilence && this.drawNoteArrows) {
          try {
            // Octave arrow backgrounds are drawn in a batched instanced pass above.
            // This per-note block intentionally does not draw backgrounds to avoid per-frame buffer uploads.
            // (Gated on drawNoteArrows; silence handling stays in the isSilence branch below.)

            // Now draw the arrow glyphs centered within their halves
            const arrowFont = this.useGlyphCache ? Math.max(6, Math.round(hCss * 0.35)) : this._clampFontPx(Math.max(6, Math.round(hCss * 0.35))); // slightly smaller
            if (this.useGlyphCache) {
              const colCx = left + pad + arrowsWidth * 0.5;
              const contentTopAr = top + borderCssExact;
              const contentHAr = Math.max(0, hCss - 2 * borderCssExact);
              const topCenterY = contentTopAr + (contentHAr * 0.25);
              const botCenterY = contentTopAr + (contentHAr * 0.75);
              const bias = 0.5; // small optical bias away from midline

              // ▲ center within top half using ink bounds
              const gUp = this._getGlyphSize('▲', arrowFont);
              if (gUp) {
                const ax = colCx - gUp.w * 0.5;
                const inkTop = (gUp.inkTop != null ? gUp.inkTop : 0);
                const inkBottom = (gUp.inkBottom != null ? gUp.inkBottom : gUp.h);
                const inkH = Math.max(0, inkBottom - inkTop);
                const ay = Math.round((topCenterY - (inkTop + inkH * 0.5) - bias) * 2.0) / 2.0;
                this._deferredGlyphRuns.push({
                  text: '▲', noteId: id, x: ax, y: ay, fontPx: arrowFont, color: this._noteTextRgba(), layerZ,
                  scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                  rrCx, rrCy, rrHx, rrHy, rrR
                });
              }

              // ▼ center within bottom half using ink bounds
              const gDn = this._getGlyphSize('▼', arrowFont);
              if (gDn) {
                const ax = colCx - gDn.w * 0.5;
                const inkTop = (gDn.inkTop != null ? gDn.inkTop : 0);
                const inkBottom = (gDn.inkBottom != null ? gDn.inkBottom : gDn.h);
                const inkH = Math.max(0, inkBottom - inkTop);
                const ay = Math.round((botCenterY - (inkTop + inkH * 0.5) + bias) * 2.0) / 2.0;
                this._deferredGlyphRuns.push({
                  text: '▼', noteId: id, x: ax, y: ay, fontPx: arrowFont, color: this._noteTextRgba(), layerZ,
                  scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                  rrCx, rrCy, rrHx, rrHy, rrR
                });
              }
            } else {
              gl.useProgram(textProg);
              if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
              if (uTint) gl.uniform4f(uTint, 1, 1, 1, 1);

              const colCx = left + pad + arrowsWidth * 0.5;
              const contentTopAr = top + borderCssExact;
              const contentHAr = Math.max(0, hCss - 2 * borderCssExact);
              const topCenterY = contentTopAr + (contentHAr * 0.25);
              const botCenterY = contentTopAr + (contentHAr * 0.75);
              const bias = 0.5;

              const upEntry = this._createStyledTextTexture('▲', arrowFont, 0, this._noteTextHex(), 'rgba(0,0,0,0)', 0);
              if (upEntry && upEntry.tex) {
                const ax = colCx - upEntry.wCss * 0.5;
                const ay = Math.round((topCenterY - upEntry.hCss * 0.5 - bias) * 2.0) / 2.0;
                const arrU = new Float32Array([ax, ay, upEntry.wCss, upEntry.hCss]);
                if (uZText) gl.uniform1f(uZText, layerZ);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, upEntry.tex);
                gl.bindVertexArray(this.textVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, arrU, gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              }

              const downEntry = this._createStyledTextTexture('▼', arrowFont, 0, this._noteTextHex(), 'rgba(0,0,0,0)', 0);
              if (downEntry && downEntry.tex) {
                const ax = colCx - downEntry.wCss * 0.5;
                const ay = Math.round((botCenterY - downEntry.hCss * 0.5 + bias) * 2.0) / 2.0;
                const arrD = new Float32Array([ax, ay, downEntry.wCss, downEntry.hCss]);
                if (uZText) gl.uniform1f(uZText, layerZ);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, downEntry.tex);
                gl.bindVertexArray(this.textVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, arrD, gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              }
            }
          } catch {}
        } else if (isSilence) {
          // 3-alt) Silence: no octave arrows. Draw a rounded dashed ring using SDF so corners are rounded and thickness matches normal border.
          // (Explicit isSilence guard: a non-silence note with arrows disabled
          // must draw neither arrows nor a silence ring.)
          try {
            if (!batchSilenceRings && this.silenceDashRingProgram && this.rectVAO) {
              gl.useProgram(this.silenceDashRingProgram);
              const Usr = (this._uniforms && this._uniforms.silenceRing) ? this._uniforms.silenceRing : null;
              const uMat   = Usr ? Usr.u_matrix      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_matrix');
              const uVP    = Usr ? Usr.u_viewport    : gl.getUniformLocation(this.silenceDashRingProgram, 'u_viewport');
              const uOff   = Usr ? Usr.u_offset      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_offset');
              const uCR    = Usr ? Usr.u_cornerRadius: gl.getUniformLocation(this.silenceDashRingProgram, 'u_cornerRadius');
              const uBW    = Usr ? Usr.u_borderWidth : gl.getUniformLocation(this.silenceDashRingProgram, 'u_borderWidth');
              const uCol   = Usr ? Usr.u_color       : gl.getUniformLocation(this.silenceDashRingProgram, 'u_color');
              const uDash  = Usr ? Usr.u_dashLen     : gl.getUniformLocation(this.silenceDashRingProgram, 'u_dashLen');
              const uGap   = Usr ? Usr.u_gapLen      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_gapLen');
              const uLB    = Usr ? Usr.u_layerBase   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_layerBase');
              const uLS    = Usr ? Usr.u_layerStep   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_layerStep');
              const uSC    = Usr ? Usr.u_scale       : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scale');

              if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
              if (uVP)  gl.uniform2f(uVP, vpW, vpH);
              if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
              { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
              // Match normal border thickness exactly
              { const bw = (this._config?.note?.borderPxAtZoom1 ?? 1.0); if (uBW)  gl.uniform1f(uBW, bw * (this.xScalePxPerWU || 1.0)); }
              // Match the themed note border
              { const nb = this._noteBorderRgba(); if (uCol) gl.uniform4f(uCol, nb[0], nb[1], nb[2], nb[3]); }
              // Scale dash/gap with zoom so dash COUNT remains consistent across zoom
              {
                const zoomF = Math.max(
                  0.0001,
                  (this.xScalePxPerWU || 1.0) / (this._xScaleAtInit || (this.xScalePxPerWU || 1.0))
                );
                if (uDash) gl.uniform1f(uDash, 3.0 * zoomF);
                if (uGap)  gl.uniform1f(uGap, 3.0 * zoomF);
              }
              if (uLB)   gl.uniform1f(uLB, layerZ);
              if (uLS)   gl.uniform1f(uLS, 0.0);
              if (uSC)   gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
              // Provide anisotropic zoom scales to shader
              const uSX = Usr ? Usr.u_scaleX : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scaleX');
              const uSY = Usr ? Usr.u_scaleY : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scaleY');
              const uAB = Usr ? Usr.u_alignBias : gl.getUniformLocation(this.silenceDashRingProgram, 'u_alignBias');
              if (uSX) gl.uniform1f(uSX, (this.xScalePxPerWU || 1.0));
              if (uSY) gl.uniform1f(uSY, (this.yScalePxPerWU || 1.0));
              // Sub-pixel inward bias so dashed ring thickness aligns visually with the solid border
              if (uAB) gl.uniform1f(uAB, (this._config?.silenceRing?.alignBiasPx ?? 0.25));
              // Drag offset for dashed ring (moves with note body/width during drag)
              {
                const uDrag = Usr ? Usr.u_dragOffset : gl.getUniformLocation(this.silenceDashRingProgram, 'u_dragOffset');
                if (uDrag) gl.uniform2f(uDrag, this._dragOffsetX || 0.0, this._dragOffsetW || 0.0);
              }
 
              // Use full-extent scissor for the dashed ring so it is not inset by the interior-only scissor.
              // This avoids clipping the outer half of the dashed border and prevents cross-note bleed.
              gl.enable(gl.SCISSOR_TEST);
              gl.scissor(
                Math.max(0, Math.floor(left * dpr)),
                Math.max(0, Math.floor((vpH - (top + hCss)) * dpr)),
                Math.max(0, Math.floor(wCss * dpr)),
                Math.max(0, Math.floor(hCss * dpr))
              );
 
              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.enable(gl.DEPTH_TEST);
              gl.depthFunc(gl.LEQUAL);
              gl.depthMask(false);
 
              // Bind single-instance attributes for this note
              // Disable unused attrib 4 for single-instance silence ring draw
              this._setAttr4Enabled(false);
              gl.bindVertexArray(this.rectVAO);
              const arrPos = new Float32Array([xw, yw, positions[o + 2], positions[o + 3]]);
              // Use dedicated single-instance buffer and temporarily re-point attrib 1
              if (!this._singlePosSizeBuffer) {
                this._singlePosSizeBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
              }
              gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arrPos, gl.DYNAMIC_DRAW);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              // Note CSS size derived in-shader via u_scale (no per-instance size buffer)
 
              // Draw just one instance
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
 
              // Restore attrib 1 to the shared instanced buffer for subsequent draws
              gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              gl.bindVertexArray(null);
              // Re-enable attrib 4 for subsequent passes
              this._setAttr4Enabled(true);
 
              // Restore interior scissor for any subsequent per-note overlays
              gl.scissor(
                Math.max(0, Math.floor(scLeftCss * dpr)),
                Math.max(0, Math.floor((vpH - (scTopCss + scHeightCss)) * dpr)),
                Math.max(0, Math.floor(scWidthCss * dpr)),
                Math.max(0, Math.floor(scHeightCss * dpr))
              );
 
              // Restore premultiplied-alpha for subsequent text
              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            }
          } catch {}
        }

        // 4) Right pull tab handled by batched SDF-masked pass above (tabMaskProgram)
        // Note scissor not used; atlas per-fragment clip handles overflow
      }
      }
      this._dividerRegions = _dividerRegions; this._anyDivider = _anyDivider;
      this._silenceEraseRegions = _silenceEraseRegions; this._anySilenceErase = _anySilenceErase;

      // Batched silence erase bands (covers any DOM-drawn fraction bar when glonly=0)
      try {
        if (this.enableSilenceEraseBands && this.tabMaskProgram && this.rectVAO && this.rectInstanceDividerRegionBuffer && this._anySilenceErase && this._silenceEraseRegions) {
          
          gl.useProgram(this.tabMaskProgram);
          const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
          const uMat = Utb ? Utb.u_matrix      : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
          const uVP  = Utb ? Utb.u_viewport    : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
          const uOff = Utb ? Utb.u_offset      : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
          const uCR  = Utb ? Utb.u_cornerRadius: gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
          const uBW  = Utb ? Utb.u_borderWidth : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
          const uCol = Utb ? Utb.u_color       : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
          const uLB  = Utb ? Utb.u_layerBase   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
          const uLS  = Utb ? Utb.u_layerStep   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
          const uSC  = Utb ? Utb.u_scale       : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');
          const uBias= Utb ? Utb.u_clipBias    : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');

          const rectCss2 = this.canvas.getBoundingClientRect();
          const vpW2 = Math.max(1, rectCss2.width);
          const vpH2 = Math.max(1, rectCss2.height);

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW2, vpH2);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
          if (uLB)  gl.uniform1f(uLB, 1.0);
          const stepZ2 = -1.0 / Math.max(1, this.instanceCount + 5);
          if (uLS)  gl.uniform1f(uLS, stepZ2);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          {
            const uDrag = Utb ? Utb.u_dragOffset : gl.getUniformLocation(this.tabMaskProgram, 'u_dragOffset');
            if (uDrag) gl.uniform2f(uDrag, this._dragOffsetX || 0.0, this._dragOffsetW || 0.0);
          }
          if (uBias) gl.uniform1f(uBias, 0.0);
          // Use black fill with full alpha to reliably cover DOM fraction line
          if (uCol) gl.uniform4f(uCol, 0.0, 0.0, 0.0, 1.0);

          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.disable(gl.SCISSOR_TEST);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);

          gl.bindVertexArray(this.rectVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDividerRegionBuffer);
          this._uploadVisibleRegions(this._silenceEraseRegions);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          this._drawVisibleInstances(this.tabMaskProgram, this.rectInstanceDividerRegionBuffer);

          // Restore attribute 4 to primary buffer
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);

          gl.bindVertexArray(null);
        }
      } catch {}

      // Batched fraction dividers (single instanced pass, masked to inner rounded-rect)
      try {
        if (this.tabMaskProgram && this.rectVAO && this.rectInstanceDividerRegionBuffer && _anyDivider) {
          
          gl.useProgram(this.tabMaskProgram);
          const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
          const uMat = Utb ? Utb.u_matrix      : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
          const uVP  = Utb ? Utb.u_viewport    : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
          const uOff = Utb ? Utb.u_offset      : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
          const uCR  = Utb ? Utb.u_cornerRadius: gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
          const uBW  = Utb ? Utb.u_borderWidth : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
          const uCol = Utb ? Utb.u_color       : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
          const uLB  = Utb ? Utb.u_layerBase   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
          const uLS  = Utb ? Utb.u_layerStep   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
          const uSC  = Utb ? Utb.u_scale       : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');
          const uBias= Utb ? Utb.u_clipBias    : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');

          const rectCss = this.canvas.getBoundingClientRect();
          const vpW = Math.max(1, rectCss.width);
          const vpH = Math.max(1, rectCss.height);

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
          { const bw = (this._config?.note?.borderPxAtZoom1 ?? 1.0); if (uBW)  gl.uniform1f(uBW, bw * (this.xScalePxPerWU || 1.0)); }
          if (uLB)  gl.uniform1f(uLB, 1.0);
          const stepZ = -1.0 / Math.max(1, this.instanceCount + 5);
          if (uLS)  gl.uniform1f(uLS, stepZ);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          {
            const uDrag = Utb ? Utb.u_dragOffset : gl.getUniformLocation(this.tabMaskProgram, 'u_dragOffset');
            if (uDrag) gl.uniform2f(uDrag, this._dragOffsetX || 0.0, this._dragOffsetW || 0.0);
          }
          if (uBias) gl.uniform1f(uBias, 0.0);
          { const tcTxt = this._noteTextRgba(); if (uCol) gl.uniform4f(uCol, tcTxt[0], tcTxt[1], tcTxt[2], 1.0); }

          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.disable(gl.SCISSOR_TEST);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);

          gl.bindVertexArray(this.rectVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDividerRegionBuffer);
          this._uploadVisibleRegions(_dividerRegions);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          this._drawVisibleInstances(this.tabMaskProgram, this.rectInstanceDividerRegionBuffer);

          // Restore attribute 4 to primary buffer
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);

          gl.bindVertexArray(null);
        }
      } catch {}

      // Batched silence dashed rings (single instanced pass; non-silence instances discard in shader)
      try {
        if (batchSilenceRings && this.silenceDashRingProgram && this.rectVAO && this.instanceCount > 0) {
          
          gl.useProgram(this.silenceDashRingProgram);
          const Usr = (this._uniforms && this._uniforms.silenceRing) ? this._uniforms.silenceRing : null;
          const uMat   = Usr ? Usr.u_matrix      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_matrix');
          const uVP    = Usr ? Usr.u_viewport    : gl.getUniformLocation(this.silenceDashRingProgram, 'u_viewport');
          const uOff   = Usr ? Usr.u_offset      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_offset');
          const uCR    = Usr ? Usr.u_cornerRadius: gl.getUniformLocation(this.silenceDashRingProgram, 'u_cornerRadius');
          const uBW    = Usr ? Usr.u_borderWidth : gl.getUniformLocation(this.silenceDashRingProgram, 'u_borderWidth');
          const uCol   = Usr ? Usr.u_color       : gl.getUniformLocation(this.silenceDashRingProgram, 'u_color');
          const uDash  = Usr ? Usr.u_dashLen     : gl.getUniformLocation(this.silenceDashRingProgram, 'u_dashLen');
          const uGap   = Usr ? Usr.u_gapLen      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_gapLen');
          const uLB    = Usr ? Usr.u_layerBase   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_layerBase');
          const uLS    = Usr ? Usr.u_layerStep   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_layerStep');
          const uSC    = Usr ? Usr.u_scale       : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scale');
          const uSX    = Usr ? Usr.u_scaleX      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scaleX');
          const uSY    = Usr ? Usr.u_scaleY      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scaleY');
          const uAB    = Usr ? Usr.u_alignBias   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_alignBias');

          const rectCss = this.canvas.getBoundingClientRect();
          const vpW = Math.max(1, rectCss.width);
          const vpH = Math.max(1, rectCss.height);

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          { const cr = (this._config?.note?.roundedCornerPxAtZoom1 ?? 6.0); if (uCR)  gl.uniform1f(uCR, cr * (this.xScalePxPerWU || 1.0)); }
          { const bw = (this._config?.note?.borderPxAtZoom1 ?? 1.0); if (uBW)  gl.uniform1f(uBW, bw * (this.xScalePxPerWU || 1.0)); }
          { const nb = this._noteBorderRgba(); if (uCol) gl.uniform4f(uCol, nb[0], nb[1], nb[2], nb[3]); } // themed note border

          {
            const zoomF = Math.max(
              0.0001,
              (this.xScalePxPerWU || 1.0) / (this._xScaleAtInit || (this.xScalePxPerWU || 1.0))
            );
            {
              const d = (this._config?.silenceRing?.dashPx ?? 3.0);
              const g = (this._config?.silenceRing?.gapPx  ?? 3.0);
              if (uDash) gl.uniform1f(uDash, d * zoomF);
              if (uGap)  gl.uniform1f(uGap,  g * zoomF);
            }
          }
          if (uLB)   gl.uniform1f(uLB, 1.0);
          const stepZ = -1.0 / Math.max(1, this.instanceCount + 5);
          if (uLS)   gl.uniform1f(uLS, stepZ);
          if (uSC)   gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          if (uSX)   gl.uniform1f(uSX, (this.xScalePxPerWU || 1.0));
          if (uSY)   gl.uniform1f(uSY, (this.yScalePxPerWU || 1.0));
          if (uAB)   gl.uniform1f(uAB, (this._config?.silenceRing?.alignBiasPx ?? 0.25));
          // Drag offset for dashed ring (batched path)
          {
            const uDrag = Usr ? Usr.u_dragOffset : gl.getUniformLocation(this.silenceDashRingProgram, 'u_dragOffset');
            if (uDrag) gl.uniform2f(uDrag, this._dragOffsetX || 0.0, this._dragOffsetW || 0.0);
          }

          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);
          gl.disable(gl.SCISSOR_TEST);

          gl.bindVertexArray(this.rectVAO);
          // Uses the existing per-instance attributes (posSize, flags)
          this._drawVisibleInstances(this.silenceDashRingProgram);
          gl.bindVertexArray(null);
        }
      } catch {}

      // Text sprites are enqueued into this._deferredTextSprites above and flushed
      // at the end of proto._render() to ensure they render above all geometry.

      // Restore default blending for non-text draws
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // Re-enable depth writes for subsequent passes
      gl.depthMask(true);
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    };

    // Continued-fraction approximation for ratio -> fraction text (n/d)
    proto._approximateFraction = function (x, maxDen, maxDigits) {
      try {
        maxDen = maxDen || 8192;
        maxDigits = maxDigits || 4;
        if (!isFinite(x) || x <= 0) return { n: 1, d: 1 };

        let a0 = Math.floor(x);
        let p0 = 1, q0 = 0, p1 = a0, q1 = 1;
        let frac = x - a0;

        // Limit numerator by digit count to keep up to 4 digits
        const maxNum = Math.pow(10, maxDigits) - 1;

        while (frac > 1e-12) {
          const a = Math.floor(1.0 / frac);
          const p2 = a * p1 + p0;
          const q2 = a * q1 + q0;
          if (q2 > maxDen || p2 > maxNum) break;
          p0 = p1; q0 = q1; p1 = p2; q1 = q2;
          frac = 1.0 / frac - a;
        }

        let n = p1, d = q1;
        if (d === 0) return { n: 1, d: 1 };

        // Fallback clamp if still too large
        if (String(n).length > maxDigits || String(d).length > maxDigits) {
          const scale = Math.pow(10, Math.max(1, maxDigits - 1));
          n = Math.round(x * scale);
          d = scale;
        }
        return { n, d };
      } catch {
        return { n: 1, d: 1 };
      }
    };

    // ===== Text helpers: caps and clamps =====
    proto._getMaxTextureCapPx = function () {
      try {
        const hard = (this._maxTextureSize != null) ? this._maxTextureSize : (this.gl ? this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) : null);
        const soft = this._softTextureCapPx || 1024;
        return Math.max(1, Math.min(soft, hard || soft));
      } catch {
        return this._softTextureCapPx || 1024;
      }
    };
    // Given desired backing store width/height in device pixels, return scale<=1 to fit within caps
    proto._calcTextBackingScale = function (wPx, hPx) {
      const cap = this._getMaxTextureCapPx();
      const m = Math.max(1, Math.max(wPx || 1, hPx || 1));
      if (m <= cap) return 1.0;
      return cap / m;
    };
    proto._clampFontPx = function (px) {
      const cap = this._maxOnscreenFontPx || 96;
      const pxi = Math.max(1, Math.floor(px || 1));
      return Math.min(cap, pxi);
    };

    // Create/refresh a GL texture for a given label string and cache it
    proto._createTextTexture = function (label) {
      const gl = this.gl;
      if (!gl || !label) return null;
 
      const key = `${label}|${this.devicePixelRatio || 1}`;
      const cached = this._octaveLabelCache.get(key);
      if (cached) return cached;
 
      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const fontPx = 10; // CSS px (smaller to sit "in" the dotted line)
      const pad = 2;
 
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
 
      // Measure in CSS px
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      const metrics = ctx.measureText(label);
      const wCss = Math.ceil(metrics.width) + pad * 2;
      const hCss = fontPx + pad * 2;
 
      // Backing store in device pixels with cap
      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));

      // Draw text (use scaled transform to keep CSS layout while constraining backing store)
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = this._accentHex();
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 1.0;
      ctx.fillText(label, pad, pad);
 
      // Upload to GL
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Use premultiplied alpha for canvas text to avoid "dulled" look when blending over dark triangles
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // Ensure no row padding issues for small glyph textures
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss };
      this._octaveLabelCache.set(key, entry);
      return entry;
    };

    // Narrower textures for measure triangle labels (tighter padding, smaller font)
    proto._createNarrowTextTexture = function (label, fontPx = 9, pad = 1) {
      const gl = this.gl;
      if (!gl || !label) return null;

      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const key = `tri|${label}|${fontPx}|${dpr}`;
      const cached = this._octaveLabelCache.get(key);
      if (cached) return cached;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      const metrics = ctx.measureText(label);
      const wCss = Math.ceil(metrics.width) + pad * 2;
      const hCss = fontPx + pad * 2;

      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));
 
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = this._accentHex();
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 1.0;
      ctx.fillText(label, pad, pad);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Use premultiplied alpha for canvas text to avoid "dulled" look when blending over dark triangles
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // Ensure no row padding issues for small glyph textures
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss };
      this._octaveLabelCache.set(key, entry);
      return entry;
    };

    // Styled text texture (custom color/shadow) for generic labels
    proto._createStyledTextTexture = function (label, fontPx = 12, pad = 2, color = '#ffffff', shadowColor = 'rgba(0,0,0,0.0)', shadowBlur = 0) {
      const gl = this.gl;
      if (!gl || !label) return null;
      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const key = `styled|${label}|${fontPx}|${color}|${shadowColor}|${shadowBlur}|${dpr}`;
      const cached = this._octaveLabelCache.get(key);
      if (cached) return cached;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      const metrics = ctx.measureText(label);
      const wCss = Math.ceil(metrics.width) + pad * 2;
      const hCss = fontPx + pad * 2;

      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));
 
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.fillText(label, pad, pad);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // Ensure no row padding issues for small glyph textures
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss };
      this._octaveLabelCache.set(key, entry);
      return entry;
    };

    // Tight mono-digit text texture (uses actualBoundingBox metrics to trim top/bottom)
    // Intended for fraction numerators/denominators so equal gaps around the divider are visually symmetric.
    proto._createTightDigitTexture = function (label, fontPx = 12, pad = 0, color = '#ffffff') {
      const gl = this.gl;
      if (!gl || !label) return null;

      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const key = `tight|${label}|${fontPx}|${dpr}|${color}`;
      const cached = this._octaveLabelCache.get(key);
      if (cached) return cached;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      // Use alphabetic baseline to get reliable ascent/descent metrics
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(label);

      // Fallbacks if metrics not fully supported
      const ascF = Number(metrics.actualBoundingBoxAscent || fontPx * 0.8);
      const descF = Number(metrics.actualBoundingBoxDescent || fontPx * 0.2);
      const ascent = Math.ceil(ascF);
      const descent = Math.ceil(descF);
      const width = Math.ceil(metrics.width);

      const wCss = Math.max(1, width + pad * 2);
      const hCss = Math.max(1, ascent + descent + pad * 2);

      // Backing store in device pixels with cap
      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));
 
      // Draw text
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = color;
 
      // Place baseline so that top = pad and bottom = pad + ascent + descent
      const baselineY = pad + ascent;
      ctx.fillText(label, pad, baselineY);

      // Upload to GL (premultiplied alpha)
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entryTight = { tex, wCss, hCss, ascent: ascF, descent: descF };
      this._octaveLabelCache.set(key, entryTight);
      return entryTight;
    };

// ===== Glyph cache and glyph-run rendering =====
    proto._initGlyphCache = function () {
      try {
        if (this._glyphCacheInitialized) return;
        this._glyphCache = this._glyphCache || new Map();
        this._wordCache = this._wordCache || new Map();
        this._glyphBasePx = this._glyphBasePx || 64;

        // Ensure target monospace webfont is loaded to stabilize metrics (fixes per-digit vertical drift)
        try {
          const basePx = this._glyphBasePx || 64;
          const spec = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
          if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(spec, '0')) {
            document.fonts.load(spec, '0').then(() => {
              try { this._refreshGlyphCaches(); } catch {}
            }).catch(() => {});
          }
        } catch {}

        // Prewarm common glyphs used in IDs/fractions/arrows
        const chars = '0123456789[]/▲▼';
        for (let i = 0; i < chars.length; i++) {
          try { this._getGlyph(chars[i]); } catch {}
        }
        try { this._getWordSilence(); } catch {}

        this._glyphCacheInitialized = true;
      } catch {}
    };

    // Create or retrieve a single-glyph texture at base size; drawn white and tinted in shader
    proto._getGlyph = function (ch) {
      const gl = this.gl;
      if (!gl || !ch) return null;

      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const basePx = this._glyphBasePx || 64;
      const key = `glyph|${ch}|${basePx}|${dpr}`;
      if (this._glyphCache && this._glyphCache.has(key)) {
        return this._glyphCache.get(key)!;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // Measure tight bounds in CSS px at base size
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(ch);
      const ascF = Number(metrics.actualBoundingBoxAscent || basePx * 0.8);
      const descF = Number(metrics.actualBoundingBoxDescent || basePx * 0.2);
      const ascent = Math.ceil(ascF);
      const descent = Math.ceil(descF);
      const width = Math.ceil(metrics.width);
      const pad = 0;
      const wCss = Math.max(1, width + pad * 2);
      const hCss = Math.max(1, ascent + descent + pad * 2);

      // Backing store in device px with hard/soft cap
      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));

      // Draw white glyph, tight to bounds
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      const baselineY = pad + ascent;
      ctx.fillText(ch, pad, baselineY);

      // Derive tight ink bounds in CSS px by scanning alpha rows (device->CSS via current transform)
      let inkTopCss = 0;
      let inkBottomCss = hCss;
      try {
        const tr = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : { a: 1 };
        const cssPerDevice = 1 / (tr && tr.a ? tr.a : 1);
        const wDev = canvas.width | 0;
        const hDev = canvas.height | 0;
        const img = ctx.getImageData(0, 0, wDev, hDev).data;
        let topRow = -1, bottomRow = -1;
        const threshold = 8; // alpha threshold
        // scan from top
        for (let y = 0; y < hDev && topRow === -1; y++) {
          const row = y * wDev * 4;
          for (let x = 0; x < wDev; x++) {
            if (img[row + x * 4 + 3] > threshold) { topRow = y; break; }
          }
        }
        // scan from bottom
        for (let y = hDev - 1; y >= 0 && bottomRow === -1; y--) {
          const row = y * wDev * 4;
          for (let x = 0; x < wDev; x++) {
            if (img[row + x * 4 + 3] > threshold) { bottomRow = y; break; }
          }
        }
        if (topRow >= 0) inkTopCss = topRow * cssPerDevice;
        if (bottomRow >= 0) inkBottomCss = bottomRow * cssPerDevice;
      } catch {}

      // Upload to GL (PMA)
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss, ascent: ascF, descent: descF, basePx, inkTopCss, inkBottomCss };
      if (!this._glyphCache) this._glyphCache = new Map();
      this._glyphCache.set(key, entry);
      return entry;
    };

    // Return scaled size for a glyph at target fontPx (including ink bounds)
    proto._getGlyphSize = function (ch, targetFontPx) {
      try {
        const g = this._getGlyph(ch);
        if (!g) return null;
        const scale = Math.max(1e-6, (targetFontPx || 1) / (g.basePx || 64));
        return {
          w: g.wCss * scale,
          h: g.hCss * scale,
          ascent: g.ascent * scale,
          inkTop: (g.inkTopCss != null ? g.inkTopCss : 0) * scale,
          inkBottom: (g.inkBottomCss != null ? g.inkBottomCss : g.hCss) * scale
        };
      } catch {
        return null;
      }
    };

    // Refresh all glyph/word/label caches after fonts load; re-prewarm and request redraw
    proto._refreshGlyphCaches = function () {
      const gl = this.gl;
      // Text metrics are memoised per (text, fontPx) and are only valid for the font face
      // they were measured with, so a font swap must drop them along with the glyph textures.
      try { if (this._runMetricsCache) this._runMetricsCache.clear(); } catch {}
      try { this._atlasGlyphCache = null; } catch {}
      try {
        if (this._glyphCache) {
          for (const e of this._glyphCache.values()) {
            try { if (gl && e && e.tex) gl.deleteTexture(e.tex); } catch {}
          }
        }
        if (this._wordCache) {
          for (const e of this._wordCache.values()) {
            try { if (gl && e && e.tex) gl.deleteTexture(e.tex); } catch {}
          }
        }
        if (this._octaveLabelCache) {
          for (const e of this._octaveLabelCache.values()) {
            try { if (gl && e && e.tex) gl.deleteTexture(e.tex); } catch {}
          }
        }
      } catch {}
      this._glyphCache = new Map();
      this._wordCache = new Map();
      this._octaveLabelCache = new Map();
      this._glyphCacheInitialized = false;
      try { this._initGlyphCache(); } catch {}
      // The cached glyph RUNS were laid out with the previous font's metrics, so they must be
      // rebuilt, not just redrawn — otherwise the new glyphs get positioned with stale widths
      // and ascents. Requesting a redraw alone was enough only while _viewEpoch churned every
      // frame and forced a rebuild anyway.
      this._textDirty = true;
      this.needsRedraw = true;
    };

    // Measure run width by summing individual glyph widths at target size
    proto._measureGlyphRunWidth = function (text, targetFontPx) {
      if (!text) return 0;
      let w = 0;
      for (let i = 0; i < text.length; i++) {
        const s = this._getGlyphSize(text[i], targetFontPx);
        w += s ? s.w : 0;
      }
      return w;
    };

    // Return representative ascent (max across run) at target size
    proto._getRunAscent = function (text, targetFontPx) {
      if (!text || text.length === 0) return targetFontPx || 0;
      let asc = 0;
      for (let i = 0; i < text.length; i++) {
        const s = this._getGlyphSize(text[i], targetFontPx);
        if (s && s.ascent != null) asc = Math.max(asc, s.ascent);
      }
      return asc || (targetFontPx || 0);
    };
    // Return representative run height (max glyph height) at target size
    proto._getRunHeight = function (text, targetFontPx) {
      if (!text || text.length === 0) return targetFontPx || 0;
      let h = 0;
      for (let i = 0; i < text.length; i++) {
        const s = this._getGlyphSize(text[i], targetFontPx);
        if (s && s.h != null) h = Math.max(h, s.h);
      }
      return h || (targetFontPx || 0);
    };
    // Canvas-measured run metrics to mirror DOM text metrics exactly (fixes numerator drift for some digits)
    proto._measureRunMetricsCanvas = function (text, fontPx) {
      const input = (text != null) ? String(text) : '';

      // Memoised: this is a pure function of (text, fontPx, font-face), but it was being
      // called from the per-note loop, so it ran two Canvas2D measureText() calls per note
      // per frame. measureText with actualBoundingBox metrics forces text shaping and is one
      // of the most expensive 2D ops there is; at 5k notes that alone was ~10k shaping calls
      // a frame. The font face only changes on load, where _refreshGlyphCaches clears this.
      const key = fontPx + '|' + input;
      let cache = this._runMetricsCache;
      if (!cache) cache = this._runMetricsCache = new Map();
      const hit = cache.get(key);
      if (hit !== undefined) return hit;

      let out;
      try {
        if (!this._metricsCanvas) this._metricsCanvas = document.createElement('canvas');
        if (!this._metricsCtx) this._metricsCtx = this._metricsCanvas.getContext('2d');
        const ctx = this._metricsCtx;
        if (!ctx) throw new Error('Canvas2D context unavailable');
        ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
        ctx.textBaseline = 'alphabetic';
        // Normalize ascent for numeric runs by measuring a canonical digit set,
        // which stabilizes cap-height across digits like 1,2,4,7,9 without per-digit biases.
        const canonical = (/^[0-9]+$/.test(input) ? '0123456789' : input);
        const mCanon = ctx.measureText(canonical);
        const asc = Number(mCanon.actualBoundingBoxAscent || fontPx * 0.8);
        const desc = Number(mCanon.actualBoundingBoxDescent || fontPx * 0.2);
        // Report width for the actual input text to preserve layout decisions, not the canonical string.
        const mInput = ctx.measureText(input);
        const width = Math.ceil(mInput.width || 0);
        const height = Math.ceil(asc + desc);
        out = { ascent: asc, descent: desc, width, height };
      } catch {
        out = { ascent: fontPx || 0, descent: 0, width: 0, height: fontPx || 0 };
      }

      // fontPx tracks zoom continuously, so the key space is unbounded over a long
      // session; drop the whole map rather than let it grow without limit.
      if (cache.size > 8192) cache.clear();
      cache.set(key, out);
      return out;
    };

    // Cached full-word texture for "silence" drawn once at base size
    proto._getWordSilence = function () {
      const gl = this.gl;
      if (!gl) return null;

      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const basePx = this._glyphBasePx || 64;
      const key = `word|silence|${basePx}|${dpr}`;
      if (!this._wordCache) this._wordCache = new Map();
      if (this._wordCache.has(key)) return this._wordCache.get(key)!;

      const label = 'silence';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(label);
      const ascF = Number(metrics.actualBoundingBoxAscent || basePx * 0.8);
      const descF = Number(metrics.actualBoundingBoxDescent || basePx * 0.2);
      const ascent = Math.ceil(ascF);
      const descent = Math.ceil(descF);
      const width = Math.ceil(metrics.width);
      const pad = 0;
      const wCss = Math.max(1, width + pad * 2);
      const hCss = Math.max(1, ascent + descent + pad * 2);

      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));

      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      const baselineY = pad + ascent;
      ctx.fillText(label, pad, baselineY);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss, basePx };
      this._wordCache.set(key, entry);
      return entry;
    };

    // ===== Glyph atlas: instanced text draw (single draw for all glyphs) =====
    // Initializes a single atlas texture and an instanced pipeline to render all glyphs
    // in one draw call, with per-instance clip rect to emulate scissoring.
    proto._initGlyphAtlas = function () {
      const gl = this.gl;
      if (!gl) return;

      // Avoid re-init
      if (this.atlasTextProgram && this._atlas && this.atlasVAO) return;

      // Create atlas program
      const atlasVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        layout(location=2) in vec4 a_uvRect;       // (u0, v0, u1, v1)
        layout(location=3) in vec4 a_color;        // RGBA tint (premultiplied-safe factor)
        layout(location=4) in float a_z;           // depth layer per glyph
        layout(location=5) in vec4 a_clipRect;     // (x, y, w, h) CSS px clip rect
        layout(location=6) in vec4 a_rrCenterSize; // (cx, cy, hx, hy) in CSS px
        layout(location=7) in float a_rrRadius;    // inner rounded-rect radius in CSS px
        layout(location=8) in float a_dragFlagGlyph; // 1.0 = apply horizontal drag x offset, 0.0 = none

        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_dragCssX;                  // CSS px horizontal drag offset (applied when a_dragFlagGlyph==1)

        out vec2 v_uv;
        out vec4 v_color;
        out vec2 v_css;
        out vec4 v_clipRect;
        out vec4 v_rrCenterSize;
        out float v_rrRadius;

        void main() {
          // Canvas-local CSS px for this vertex
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw;
          // Apply horizontal drag offset only to glyphs belonging to moving notes
          local.x += a_dragFlagGlyph * u_dragCssX;

          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, a_z, 1.0);

          // UV from instance rect
          vec2 uv0 = a_uvRect.xy;
          vec2 uv1 = a_uvRect.zw;
          v_uv = mix(uv0, uv1, a_unit);

          v_color = a_color;
          v_css = local;
          // Shift clip rect by the same CSS drag X so moving glyphs remain inside their note
          vec4 clip = a_clipRect;
          clip.x += a_dragFlagGlyph * u_dragCssX;
          v_clipRect = clip;
          // Shift rounded-rect interior mask center similarly
          vec4 rr = a_rrCenterSize;
          rr.x += a_dragFlagGlyph * u_dragCssX;
          v_rrCenterSize = rr;
          v_rrRadius = a_rrRadius;
        }
      `;
      const atlasFS = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        in vec4 v_color;
        in vec2 v_css;
        in vec4 v_clipRect;
        in vec4 v_rrCenterSize; // (cx, cy, hx, hy)
        in float v_rrRadius;
        uniform sampler2D u_tex;
        out vec4 outColor;

        float sdRoundRect(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - (b - vec2(r));
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }

        void main() {
          // Coarse AABB clip to note box to avoid cross-note bleed
          bool inX = v_css.x >= v_clipRect.x && v_css.x <= (v_clipRect.x + v_clipRect.z);
          bool inY = v_css.y >= v_clipRect.y && v_css.y <= (v_clipRect.y + v_clipRect.w);
          if (!(inX && inY)) { discard; }

          // Fine mask: inner rounded-rect (matches note interior)
          float mask = 1.0;
          if (v_rrRadius > 0.0 && v_rrCenterSize.z > 0.0 && v_rrCenterSize.w > 0.0) {
            vec2 p  = v_css - v_rrCenterSize.xy;
            vec2 he = v_rrCenterSize.zw;
            float r = min(v_rrRadius, min(he.x, he.y));
            float d = sdRoundRect(p, he, r);
            float aa = max(fwidth(d), 1.0);
            float inner = 1.0 - smoothstep(0.0, aa, d);
            mask *= inner;
          }

          if (mask <= 0.0) { discard; }

          vec4 c = texture(u_tex, v_uv);
          // PMA-friendly modulation and mask
          outColor = c * v_color * mask;
          if (outColor.a <= 0.0) discard;
        }
      `;
      this.atlasTextProgram = this._createProgram(atlasVS, atlasFS);
      // Cache uniforms
      try {
        this._uniforms.atlas = this._uniforms.atlas || {};
        if (this.atlasTextProgram && this.gl) {
          const p = this.atlasTextProgram;
          this._uniforms.atlas.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.atlas.u_tex      = gl.getUniformLocation(p, 'u_tex');
          this._uniforms.atlas.u_dragCssX = gl.getUniformLocation(p, 'u_dragCssX');
        }
      } catch {}

      // VAO + buffers
      this.atlasVAO = gl.createVertexArray();
      gl.bindVertexArray(this.atlasVAO);

      // Unit quad
      this._atlasUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._atlasUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      // a_posSizeCss (loc 1)
      this.atlasPosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      // a_uvRect (loc 2)
      this.atlasUVRectBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasUVRectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      // a_color (loc 3)
      this.atlasColorBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(3, 1);

      // a_z (loc 4)
      this.atlasZBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasZBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 1 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(4, 1);

      // a_clipRect (loc 5)
      this.atlasClipRectBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasClipRectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(5);
      gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(5, 1);

      // a_rrCenterSize (loc 6)
      this.atlasRRCenterSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasRRCenterSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(6);
      gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(6, 1);

      // a_rrRadius (loc 7)
      this.atlasRRRadiusBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasRRRadiusBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 1 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(7);
      gl.vertexAttribPointer(7, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(7, 1);

      // a_dragFlagGlyph (loc 8)
      this.atlasDragFlagBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasDragFlagBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 1 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(8);
      gl.vertexAttribPointer(8, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(8, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Backing canvas + GL texture atlas
      const cap = this._getMaxTextureCapPx ? this._getMaxTextureCapPx() : 1024;
      const size = Math.max(256, Math.min(1024, cap)); // conservative default
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, size, size);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Allocate empty atlas
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      this._atlas = {
        tex,
        canvas,
        ctx,
        w: size,
        h: size,
        pad: 2,
        nextX: 2,
        nextY: 2,
        rowH: 0,
        map: new Map() // ch -> { u0,v0,u1,v1,wCss,hCss,basePx }
      };

      // Prewarm common glyphs
      try {
        const seed = '0123456789[]/+-▲▼silenceBaseNoteNote ';
        for (let i = 0; i < seed.length; i++) this._ensureAtlasGlyph(seed[i]);
      } catch {}
    };

    // Ensure a glyph exists in the atlas; uploads if missing. Returns atlas entry.
    proto._ensureAtlasGlyph = function (ch) {
      const gl = this.gl;
      if (!gl || !this._atlas || !ch) return null;

      const basePx = this._glyphBasePx || 64;
      const key = `${ch}|${basePx}`;
      const m = this._atlas.map;
      if (m.has(key)) return m.get(key);

      // Rasterize glyph at base size into temporary canvas (reuse glyph cache metrics)
      const tmpCanvas = document.createElement('canvas');
      const ctx = tmpCanvas.getContext('2d');
      if (!ctx) return null;
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(ch);
      const ascF = Number(metrics.actualBoundingBoxAscent || basePx * 0.8);
      const descF = Number(metrics.actualBoundingBoxDescent || basePx * 0.2);
      const ascent = Math.ceil(ascF);
      const descent = Math.ceil(descF);
      const width = Math.ceil(metrics.width);
      const pad = 0;
      const wCss = Math.max(1, width + pad * 2);
      const hCss = Math.max(1, ascent + descent + pad * 2);

      tmpCanvas.width = wCss;
      tmpCanvas.height = hCss;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ch, pad, pad + ascent);

      // Shelf-pack in atlas
      const A = this._atlas;
      const needW = wCss + A.pad;
      const needH = hCss + A.pad;
      if (A.nextX + needW > A.w) {
        // new row
        A.nextX = A.pad;
        A.nextY += (A.rowH + A.pad);
        A.rowH = 0;
      }
      if (A.nextY + needH > A.h) {
        // Atlas full: hard reset (simple strategy)
        // Clear atlas and restart packing
        A.ctx.setTransform(1, 0, 0, 1, 0, 0);
        A.ctx.clearRect(0, 0, A.w, A.h);
        A.nextX = A.pad;
        A.nextY = A.pad;
        A.rowH = 0;
        A.map.clear();
      }
      const x = A.nextX;
      const y = A.nextY;
      A.nextX += needW;
      A.rowH = Math.max(A.rowH, hCss);

      // Upload subimage
      gl.bindTexture(gl.TEXTURE_2D, A.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, tmpCanvas);
      // Optionally regenerate mipmaps if min filter uses mips (we use linear to avoid per-add cost)
      gl.bindTexture(gl.TEXTURE_2D, null);

      // UV rect
      const u0 = x / A.w;
      const v0 = y / A.h;
      const u1 = (x + wCss) / A.w;
      const v1 = (y + hCss) / A.h;

      const entry = { u0, v0, u1, v1, wCss, hCss, basePx };
      m.set(key, entry);
      return entry;
    };

    // Build a single instanced draw covering all deferred glyph runs
    proto._flushGlyphRunsAtlas = function () {
      const gl = this.gl;
      const canvas = this.canvas;
      const runs = this._deferredGlyphRuns;
      if (!gl || !canvas || !runs || runs.length === 0) return;

      if (!this.atlasTextProgram || !this.atlasVAO || !this._atlas) {
        try { this._initGlyphAtlas(); } catch {}
      }
      if (!this.atlasTextProgram || !this.atlasVAO || !this._atlas) {
        // Fallback: nothing to draw
        this._deferredGlyphRuns = [];
        return;
      }

      // The seven per-glyph instance arrays built below are a pure function of the run
      // list: text, CSS position, colour, depth and clip rect. Dragging does NOT change
      // any of them — the shader offsets moving glyphs on the GPU via u_dragCssX and
      // a_dragFlagGlyph (see atlasVS). So whenever the run list is unchanged, the buffers
      // already on the GPU are still exactly right, and re-expanding every glyph and
      // re-uploading ~7 arrays is pure waste. It was the single most expensive thing in
      // the frame: 36 ms at 5k notes, 803 ms at 100k. The identity check on the run list
      // makes reuse impossible unless the cache was built from this very array.
      // Identity, not a dirty flag: a rebuild always mints a fresh array, and a reuse frame
      // always hands back the cached one untouched. So "same array object" is a sound proof
      // that the expansion on the GPU is still current. (The _textRebuildThisFrame flag is
      // reset by the caller before we run, so it cannot be used here.)
      const cached = this._atlasGlyphCache;
      const canReuse = !!(cached && cached.runs === runs && cached.count > 0);

      // Viewport for uniforms
      const rectCss = this._cachedCanvasRect || canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      let count;
      if (canReuse) {
        count = cached.count;
      } else {
        count = this._buildAtlasGlyphInstances(runs, vpW, vpH);
        if (count <= 0) {
          this._deferredGlyphRuns = [];
          return;
        }
      }

      this._drawAtlasGlyphInstances(count, vpW, vpH, canReuse);
      this._deferredGlyphRuns = [];
    };

    // Expand the run list into the per-glyph instance arrays and upload them.
    // Returns the glyph count. Scratch arrays are reused across frames so a steady
    // state allocates nothing.
    proto._buildAtlasGlyphInstances = function (runs, vpW, vpH) {
      const gl = this.gl;
    if (!gl) return 0;

      // Count glyphs
      let glyphCount = 0;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        const t = r && r.text ? String(r.text) : '';
        glyphCount += t.length;
      }
      if (glyphCount === 0) return 0;

      const S = this._atlasScratch || (this._atlasScratch = {});
      if (!S.cap || S.cap < glyphCount) {
        const cap = Math.max(64, 1 << (32 - Math.clz32(Math.max(1, glyphCount - 1))));
        S.cap = cap;
        S.posSize = new Float32Array(cap * 4);
        S.uvRect = new Float32Array(cap * 4);
        S.color = new Float32Array(cap * 4);
        S.zArr = new Float32Array(cap);
        S.clip = new Float32Array(cap * 4);
        S.rrCS = new Float32Array(cap * 4);
        S.rrR = new Float32Array(cap);
        S.dragFlags = new Float32Array(cap);
      }
      const posSize = S.posSize!;
      const uvRect = S.uvRect!;
      const color = S.color!;
      const zArr = S.zArr!;
      const clip = S.clip!;
      const rrCS = S.rrCS!;
      const rrR = S.rrR!;

      let gi = 0;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if (!r || !r.text) continue;
        const text = String(r.text);
        const fontPx = Math.max(1, Math.floor(r.fontPx || 12));
        const scaleX = (r.scaleX != null ? r.scaleX : 1.0);
        const tint = (r.color && r.color.length === 4) ? r.color : [1,1,1,1];
        const z = ((r.layerZ != null ? r.layerZ : 0.0) - 1e-5);
        const scLeft = r.scLeft || 0, scTop = r.scTop || 0, scW = r.scW || 0, scH = r.scH || 0;

        // Rounded-rect params (optional). If absent, radius = 0 disables mask.
        const rr_cx = (r.rrCx != null ? r.rrCx : 0.0);
        const rr_cy = (r.rrCy != null ? r.rrCy : 0.0);
        const rr_hx = (r.rrHx != null ? r.rrHx : 0.0);
        const rr_hy = (r.rrHy != null ? r.rrHy : 0.0);
        const rr_rad= (r.rrR  != null ? r.rrR  : 0.0);

        let penX = r.x || 0;
        const baseY = r.y || 0;
        // Align per-glyph tops to a common baseline using run ascent to avoid vertical drift (e.g., i/l)
        const ascRun = this._getRunAscent(text, fontPx);

        for (let k = 0; k < text.length; k++) {
          const ch = text[k];
          const g = this._ensureAtlasGlyph(ch);
          if (!g) continue;

          const basePx = g.basePx || (this._glyphBasePx || 64);
          const scale = Math.max(1e-6, fontPx / basePx);
          const w = g.wCss * scale * scaleX;
          // Use glyph-specific metrics and adjust vertical position to run baseline
          const sGlyph = this._getGlyphSize(ch, fontPx);
          const h = (sGlyph && sGlyph.h != null) ? sGlyph.h : (g.hCss * scale);
          const topY = baseY + Math.max(0.0, ascRun - (sGlyph && sGlyph.ascent != null ? sGlyph.ascent : (g.ascent || basePx) * scale));

          const o4 = gi * 4;

          // pos/size
          posSize[o4 + 0] = penX;
          posSize[o4 + 1] = topY;
          posSize[o4 + 2] = w;
          posSize[o4 + 3] = h;

          // uv rect
          uvRect[o4 + 0] = g.u0;
          uvRect[o4 + 1] = g.v0;
          uvRect[o4 + 2] = g.u1;
          uvRect[o4 + 3] = g.v1;

          // color
          color[o4 + 0] = tint[0];
          color[o4 + 1] = tint[1];
          color[o4 + 2] = tint[2];
          color[o4 + 3] = tint[3];

          // z
          zArr[gi] = z;

          // clip
          clip[o4 + 0] = scLeft;
          clip[o4 + 1] = scTop;
          clip[o4 + 2] = scW;
          clip[o4 + 3] = scH;

          // rounded-rect interior
          rrCS[o4 + 0] = rr_cx;
          rrCS[o4 + 1] = rr_cy;
          rrCS[o4 + 2] = rr_hx;
          rrCS[o4 + 3] = rr_hy;
          rrR[gi] = rr_rad;

          penX += w;
          gi++;
        }
      }

      const count = gi;
      if (count <= 0) return 0;

      gl.bindVertexArray(this.atlasVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, posSize.subarray(0, count * 4), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasUVRectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvRect.subarray(0, count * 4), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, color.subarray(0, count * 4), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasZBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, zArr.subarray(0, count), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasClipRectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, clip.subarray(0, count * 4), gl.DYNAMIC_DRAW);

      if (this.atlasRRCenterSizeBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasRRCenterSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, rrCS.subarray(0, count * 4), gl.DYNAMIC_DRAW);
      }
      if (this.atlasRRRadiusBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasRRRadiusBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, rrR.subarray(0, count), gl.DYNAMIC_DRAW);
      }
      gl.bindVertexArray(null);

      // Force the drag-flag buffer to be re-uploaded: it is sized to `count`, so a
      // rebuild that changes the glyph count invalidates whatever is on the GPU.
      this._atlasDragFlagsDirty = true;
      this._atlasGlyphCache = { runs, count };
      return count;
    };

    // Per-glyph drag flags are the ONLY instance data that depends on the drag set, so
    // they are refreshed independently of the (cached) geometry above.
    proto._uploadAtlasDragFlags = function (runs, count) {
      const gl = this.gl;
      if (!gl || !this.atlasDragFlagBuffer) return;

      const moving = (this._dragActive && this._dragMovingIds && this._dragMovingIds.size)
        ? this._dragMovingIds : null;

      // Nothing to do when no note is moving now and none was moving last frame — the
      // buffer already holds all-zeros. The `dirty` flag covers drag end (one final
      // zeroing upload) and any geometry rebuild that resized the buffer.
      if (!moving && !this._atlasDragFlagsDirty) return;

      const S = this._atlasScratch;
      const dragFlags = S.dragFlags!;
      let gi = 0;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if (!r || !r.text) continue;
        const text = String(r.text);
        const flag = (moving && r.noteId != null && moving.has(Number(r.noteId))) ? 1.0 : 0.0;
        for (let k = 0; k < text.length; k++) dragFlags[gi++] = flag;
      }

      gl.bindVertexArray(this.atlasVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasDragFlagBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, dragFlags.subarray(0, count), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);

      // Keep the buffer dirty while dragging so the frame after the drag ends zeroes it.
      this._atlasDragFlagsDirty = !!moving;
    };

    proto._drawAtlasGlyphInstances = function (count, vpW, vpH, reused) {
      const gl = this.gl;
    if (!gl || !this.atlasTextProgram || !this._atlas) return;

      this._uploadAtlasDragFlags(this._deferredGlyphRuns, count);

      gl.useProgram(this.atlasTextProgram);
      const Ua = (this._uniforms && this._uniforms.atlas) ? this._uniforms.atlas : null;
      const uVP = Ua ? Ua.u_viewport : gl.getUniformLocation(this.atlasTextProgram, 'u_viewport');
      const uTex = Ua ? Ua.u_tex : gl.getUniformLocation(this.atlasTextProgram, 'u_tex');
      const uDX  = Ua ? Ua.u_dragCssX : gl.getUniformLocation(this.atlasTextProgram, 'u_dragCssX');
      if (uVP) gl.uniform2f(uVP, vpW, vpH);
      if (uTex) gl.uniform1i(uTex, 0);
      // Drag CSS offset in px: screen dx from world dx is matrix[0]*dx (y term is zero for horizontal shift)
      if (uDX) {
        const dxCss = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);
        gl.uniform1f(uDX, dxCss);
      }

      // PMA + depth test (no depth writes)
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._atlas.tex);

      gl.bindVertexArray(this.atlasVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, count);

      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.depthMask(true);
      void reused;
    };

    // Draw a glyph run at top-left (x,y) using textProgram and screen-space quads
    // Assumes caller already set u_viewport, u_tint, and u_z uniforms appropriately.
    proto._drawGlyphRun = function (text, x, y, fontPx, scaleX /* optional */) {
      const gl = this.gl;
      if (!gl || !this.textVAO || !this.textPosSizeBuffer || !text) return;

      const ascRun = this._getRunAscent(text, fontPx);
      let penX = x;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const g = this._getGlyph(ch);
        if (!g || !g.tex) continue;

        const scale = Math.max(1e-6, (fontPx || 1) / (g.basePx || 64));
        const sx = (scaleX != null ? scaleX : 1.0);
        const sGlyph = this._getGlyphSize(ch, fontPx);
        const w = (sGlyph && sGlyph.w != null ? sGlyph.w : g.wCss * scale) * sx;
        const h = (sGlyph && sGlyph.h != null ? sGlyph.h : g.hCss * scale);
        const ascGlyph = (sGlyph && sGlyph.ascent != null) ? sGlyph.ascent : (g.ascent || (fontPx * 0.8));

        // Align per-glyph top using run ascent so slim glyphs (i,l) sit on the same baseline as others
        const topY = y + Math.max(0.0, ascRun - ascGlyph);

        const arr = new Float32Array([penX, topY, w, h]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, g.tex);
        gl.bindVertexArray(this.textVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

        penX += w;
      }
    };

    // Compute octave guide world Y positions and ensure label textures exist
    proto._ensureOctaveGuides = function () {
      // Fixed range for testing
      const ks = [];
      for (let k = -8; k <= 8; k++) ks.push(k);
      this._octaveIndices = ks;

      // Ensure label textures
      for (const k of ks) {
        const label = (k === 0) ? 'BaseNote' : (k > 0 ? `+${k}` : `${k}`);
        this._createTextTexture(label);
      }
    };

    // Render horizontal dotted lines and labels in screen space
    proto._renderOctaveGuides = function () {
      const gl = this.gl;
      if (!gl || !this.canvas || !this.octaveLineProgram || !this.textProgram) return;

      // Ensure data
      this._ensureOctaveGuides();

      const rectCss = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      // Build per-instance quads for horizontal lines
      const count = this._octaveIndices.length;
      if (!this._octaveLinesPosSize || this._octaveLinesPosSize.length !== count * 4) {
        this._octaveLinesPosSize = new Float32Array(count * 4);
      }

      // Helper: world (0, y) -> canvas-local CSS px Y
      const worldYToLocalCssY = (yWorld: number) => {
        const sx = this.matrix[3] * yWorld + this.matrix[6];
        const sy = this.matrix[4] * yWorld + this.matrix[7];
        const localY = (this.canvasOffset?.y != null) ? (sy - this.canvasOffset.y) : sy;
        return localY;
      };

      // Compute Y positions and draw lines/labels
      gl.useProgram(this.octaveLineProgram);
      const uVP = gl.getUniformLocation(this.octaveLineProgram, 'u_viewport');
      const uDash = gl.getUniformLocation(this.octaveLineProgram, 'u_dashLen');
      const uGap = gl.getUniformLocation(this.octaveLineProgram, 'u_gapLen');
      const uCol = gl.getUniformLocation(this.octaveLineProgram, 'u_color');
      if (uVP) gl.uniform2f(uVP, vpW, vpH);
      if (uDash) gl.uniform1f(uDash, 3.0);
      if (uGap) gl.uniform1f(uGap, 3.0);

      gl.bindVertexArray(this.octaveLineVAO);
      // Ensure no stale scissor state can clip lines drawn near edges
      gl.disable(gl.SCISSOR_TEST);
      for (let i = 0; i < count; i++) {
        const k = this._octaveIndices[i];

        // Compute world y from frequency (ref * 2^k), where ref is BaseNote or selected note freq
        const ref = (typeof this._refFreqForGuides === 'number' && isFinite(this._refFreqForGuides))
          ? this._refFreqForGuides
          : (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
        const freq = ref * Math.pow(2, k);
        // Align to note center: center of 20px legacy row is +10 from top
        const yWorld = this._noteCenterY(freq);

        const localY = worldYToLocalCssY(yWorld);
        // Pixel-fit for crisp 1px lines
        const yAligned = Math.floor(localY) + 0.5;

        // Decide label for k
        const isPrimary = (k === 0);
        const label = isPrimary
          ? (this._selectedHasFrequencyForGuides && this._selectedNoteIdForGuides != null
               ? `Note [${this._selectedNoteIdForGuides}]`
               : 'BaseNote')
          : (k > 0 ? `+${k}` : `${k}`);

        const entry = this._createTextTexture(label);

        // Prepare line hole rectangle around text to emulate legacy "text in bar"
        // Left padding for label
        const xPad = 8.0;
        const holeX = xPad - 1.0;
        const holeY = (entry ? (yAligned - entry.hCss * 0.5) : (yAligned - 6.0)) - 1.0;
         // Clamp hole width so it never spans the entire canvas width (which would hide the line)
         const holeW = entry
           ? Math.min(entry.wCss + 2.0, Math.max(0.0, vpW - (xPad - 1.0) - 2.0))
           : 0.0;
        const holeH = (entry ? (entry.hCss + 2.0) : 12.0);

        // Upload line quad (ensure correct program is active every iteration)
        gl.useProgram(this.octaveLineProgram);
        if (uVP)  gl.uniform2f(uVP, vpW, vpH);
        if (uDash) gl.uniform1f(uDash, 3.0);
        if (uGap)  gl.uniform1f(uGap, 3.0);

        const pos = new Float32Array([-1.0, yAligned, vpW + 2.0, 1.0]);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);

        // Uniforms
        const uHole = gl.getUniformLocation(this.octaveLineProgram, 'u_holeRect');
        if (uHole) gl.uniform4f(uHole, holeX, holeY, holeW, holeH);

        // Color: primary line more prominent
        const alpha = isPrimary ? 0.9 : 0.35;
        { const a = this._accentRgba(); if (uCol) gl.uniform4f(uCol, a[0], a[1], a[2], alpha); } // themed accent (octave/base guide lines)

        // Rebind VAO each iteration since label drawing unbinds/changes it
        gl.bindVertexArray(this.octaveLineVAO);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

        // Draw label centered vertically on the line
        if (entry && entry.tex) {
          gl.useProgram(this.textProgram);
          const uVPt = gl.getUniformLocation(this.textProgram, 'u_viewport');
          const uTint = gl.getUniformLocation(this.textProgram, 'u_tint');
          const uTex = gl.getUniformLocation(this.textProgram, 'u_tex');
          if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
          // Primary slightly brighter tint
          const tintA = isPrimary ? 1.0 : 0.9;
          if (uTint) gl.uniform4f(uTint, 1, 1, 1, tintA);
          if (uTex) gl.uniform1i(uTex, 0);

          const x = xPad;
          const yTop = yAligned - entry.hCss * 0.5;
          const arr = new Float32Array([x, yTop, entry.wCss, entry.hCss]);

          // Use premultiplied-alpha-appropriate blend for text to prevent dulling over line/background
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.tex);

          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

          // Restore default blending for non-text draws
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

          gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
      }
      gl.bindVertexArray(null);
    };

    // Patch lifecycle to include measure pass
    const _origInit = proto.init;
    proto.init = function (containerEl) {
      const ok = _origInit.call(this, containerEl);
      try { this._initMeasurePass(); } catch {}
      return ok;
    };

    const _origSync = proto.sync;
    proto.sync = function (args) {
      _origSync.call(this, args);
      try { this._syncMeasureBars(args.module, this._lastSyncWasPartial ? this._syncedMeasures : null); } catch {}

      // Cache selection context for octave guides (BaseNote vs selected note)
      try {
        this._selectedNoteIdForGuides = (args && args.selectedNoteId != null) ? Number(args.selectedNoteId) : null;
        let refFreq = this._baseFreqCache;
        let selectedHasFreq = false;
        if (this._selectedNoteIdForGuides != null && args && args.module && typeof args.module.getNoteById === 'function') {
          const sel = args.module.getNoteById(this._selectedNoteIdForGuides);
          if (sel && sel.getVariable && sel.getVariable('frequency')) {
            const fv = toNumber(sel.getVariable('frequency'), NaN);
            if (fv != null && isFinite(fv)) {
              refFreq = fv;
              selectedHasFreq = true;
            }
          }
        }
        this._refFreqForGuides = refFreq;
        this._selectedHasFrequencyForGuides = selectedHasFreq;
      } catch {}

      this.needsRedraw = true;
    };

    const _origRender = proto._render;
    proto._render = function () {
      // First run the original render (clears the canvas and draws notes + playhead)
      _origRender.call(this);
      // Then draw per-note overlays (labels, fractions, arrows, pull tab) — this enqueues text sprites
      try { if (this.drawNoteOverlays) this._renderNoteOverlays(); } catch {}
      // Draw measure bars/triangles/octave guides
      try { this._renderMeasureBars(); } catch {}
      // Ensure BaseNote fraction is visible even when there are no measure triangles (clean slate)
      try { this._renderBaseFractionIfMissing(); } catch {}
      // Flush deferred text sprites last so they appear above everything
      try {
        // Atlas path in _flushGlyphRunsAtlas handles text; legacy sprite path disabled.
        this._deferredTextSprites = [];
      } catch {}

      // Flush deferred glyph runs
      try {
        const gl = this.gl;
        const canvas = this.canvas;
        const list = this._deferredGlyphRuns;
        if (this.useGlyphAtlas && this._textRebuildThisFrame) {
          // Keep the array identity (no copy): the freshly-built list becomes the cache, so
          // subsequent reuse frames hand the very same array to _flushGlyphRunsAtlas and it
          // can recognise the run list as unchanged. Copying here would mint a new identity
          // every rebuild and defeat the glyph-instance cache.
          try { this._glyphRunsCache = list; this._textDirty = false; this._lastTextViewEpoch = this._viewEpoch; this._lastTextPosEpoch = this._posEpoch; this._lastTextDragEpoch = this._dragEpoch; } catch {}
          this._textRebuildThisFrame = false;
        }
        if (this.useGlyphAtlas) {
          try { this._flushGlyphRunsAtlas(); } catch {}
        } else if (gl && canvas && list && list.length && this.textProgram && this.textVAO && this.textPosSizeBuffer) {
          const rectCss = canvas.getBoundingClientRect();
          const vpW = Math.max(1, rectCss.width);
          const vpH = Math.max(1, rectCss.height);
          const dpr = this.devicePixelRatio || 1;

          gl.useProgram(this.textProgram);
          const Ut = (this._uniforms && this._uniforms.text) ? this._uniforms.text : null;
          const uVPt = Ut ? Ut.u_viewport : gl.getUniformLocation(this.textProgram, 'u_viewport');
          const uTint = Ut ? Ut.u_tint     : gl.getUniformLocation(this.textProgram, 'u_tint');
          const uTex  = Ut ? Ut.u_tex      : gl.getUniformLocation(this.textProgram, 'u_tex');
          const uZ    = Ut ? Ut.u_z        : gl.getUniformLocation(this.textProgram, 'u_z');
          if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
          if (uTex)  gl.uniform1i(uTex, 0);

          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);

          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (!r) continue;
            if (uZ) gl.uniform1f(uZ, ((r.layerZ != null ? r.layerZ : 0.0) - 1e-5));
            if (uTint && r.color && r.color.length === 4) gl.uniform4f(uTint, r.color[0], r.color[1], r.color[2], r.color[3]);
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(
              Math.max(0, Math.floor((r.scLeft || 0) * dpr)),
              Math.max(0, Math.floor((vpH - ((r.scTop || 0) + (r.scH || 0))) * dpr)),
              Math.max(0, Math.floor((r.scW || 0) * dpr)),
              Math.max(0, Math.floor((r.scH || 0) * dpr))
            );
            this._drawGlyphRun(r.text, r.x, r.y, r.fontPx, (r.scaleX != null ? r.scaleX : 1));
          }

          gl.disable(gl.SCISSOR_TEST);
          gl.depthMask(true);
          gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D, null);
          this._deferredGlyphRuns = [];
        }
      } catch {}
    };
  } catch (e) {
    // no-op in case of transient load errors
  }

  // === CPU picking helpers for BaseNote and Measure Triangles, plus mixed-stack ===
  try {
    if (typeof RendererAdapter !== 'undefined') {
      const proto = RendererAdapter.prototype;

      // Point-in-triangle test (barycentric), CSS px space
      proto._pointInTriangle = function(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = cx - ax, v0y = cy - ay;
        const v1x = bx - ax, v1y = by - ay;
        const v2x = px - ax, v2y = py - ay;
        const dot00 = v0x * v0x + v0y * v0y;
        const dot01 = v0x * v1x + v0y * v1y;
        const dot02 = v0x * v2x + v0y * v2y;
        const dot11 = v1x * v1x + v1y * v1y;
        const dot12 = v1x * v2x + v1y * v2y;
        const denom = (dot00 * dot11 - dot01 * dot01) || 1;
        const u = (dot11 * dot02 - dot01 * dot12) / denom;
        const v = (dot00 * dot12 - dot01 * dot02) / denom;
        return (u >= 0) && (v >= 0) && (u + v <= 1);
      };

      // Hit test BaseNote circle (CSS px)
      proto.pickBaseCircleAt = function(clientX, clientY) {
        try {
          const c = this._baseCircleCss;
          if (!c || !isFinite(c.cx) || !isFinite(c.cy) || !isFinite(c.r) || c.r <= 0) return [];
          const dx = clientX - (this.canvasOffset?.x ?? 0) - c.cx;
          const dy = clientY - (this.canvasOffset?.y ?? 0) - c.cy;
          const inside = (dx * dx + dy * dy) <= (c.r * c.r);
          return inside ? [{ type: 'base', id: 0 }] : [];
        } catch { return []; }
      };

      // Hit test all measure triangles (CSS px). Returns top-most first (reverse draw order).
      proto.pickTrianglesAt = function(clientX, clientY, firstOnly = false) {
        try {
          const css = this._measureTriCss;
          const ids = this._measureTriIds;
          if (!css || !ids || !ids.length) return [];
          const px = clientX - (this.canvasOffset?.x ?? 0);
          const py = clientY - (this.canvasOffset?.y ?? 0);
          const count = Math.floor(css.length / 4);
          const hits: SceneHit[] = [];
          // Reverse order to approximate top-most first
          for (let i = count - 1; i >= 0; i--) {
            const o = i * 4;
            const left = css[o + 0], top = css[o + 1], w = css[o + 2], h = css[o + 3];
            const ax = left + w * 0.5, ay = top;           // apex (top middle)
            const bx = left,           by = top + h;       // bottom left
            const cx = left + w,       cy = top + h;       // bottom right
            if (this._pointInTriangle(px, py, ax, ay, bx, by, cx, cy)) {
              hits.push({ type: 'measure', id: ids[i] });
              if (firstOnly) break;
            }
          }
          return hits;
        } catch { return []; }
      };

      // A hover/ordinary hit needs only the first item in painter order.
      // A supplied note hit (including null) lets hover reuse its subregion probe.
      proto.pickTopAt = function(clientX, clientY, expandCssPx = 2, noteHit) {
        return this.pickTrianglesAt(clientX, clientY, true)[0] ||
          this.pickBaseCircleAt(clientX, clientY)[0] ||
          (noteHit === undefined ? this.pickAt(clientX, clientY, expandCssPx) : noteHit) ||
          this.pickReferenceLinesAt(clientX, clientY, true)[0] || null;
      };

      // Mixed-type stack at client coords: triangles (top), base, then notes (existing stack)
      proto.pickAllAt = function(clientX, clientY, expandCssPx = 2) {
        try {
          const hits = this.pickTrianglesAt(clientX, clientY);
          const base = this.pickBaseCircleAt(clientX, clientY)[0];
          if (base) hits.push(base);
          this._pickNotes(clientX, clientY, expandCssPx, hits);
          for (const line of this.pickReferenceLinesAt(clientX, clientY)) hits.push(line);
          return hits;
        } catch { return []; }
      };
    }
  } catch {}
})();
(() => {
  try {
    if (typeof RendererAdapter === 'undefined') return;
    const proto = RendererAdapter.prototype;

    // Instanced octave guides (horizontal dotted lines + label hole masks + per-instance color)
    proto._renderOctaveGuidesInstanced = function () {
      const gl = this.gl;
      if (!gl || !this.canvas) return;

      // Ensure octave indices and label textures exist
      try { this._ensureOctaveGuides(); } catch {}

      const rectCss = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      // Helper: world (0, y) -> canvas-local CSS px Y
      const worldYToLocalCssY = (yWorld: number) => {
        const sx = this.matrix[3] * yWorld + this.matrix[6];
        const sy = this.matrix[4] * yWorld + this.matrix[7];
        const localY = (this.canvasOffset?.y != null) ? (sy - this.canvasOffset.y) : sy;
        return localY;
      };

      // Lazy-init instanced program + VAO + buffers
      if (!this.octaveLineInstProgram) {
        // VS with per-instance a_posSizeCss, a_holeRect, a_color
        const octInstVS = `#version 300 es
          precision highp float;
          layout(location=0) in vec2 a_unit;         // (0..1) quad
          layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
          layout(location=2) in vec4 a_holeRect;     // (x, y, w, h) CSS px
          layout(location=3) in vec4 a_color;        // RGBA

          uniform vec2 u_viewport;

          out vec2 v_css;
          out vec4 v_holeRect;
          out vec4 v_color;

          void main() {
            vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
            float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
            float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
            gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
            v_css = local;
            v_holeRect = a_holeRect;
            v_color = a_color;
          }
        `;
        // FS with dash pattern along X and per-instance hole + color
        const octInstFS = `#version 300 es
          precision highp float;
          in vec2 v_css;
          in vec4 v_holeRect;
          in vec4 v_color;
          uniform float u_dashLen;     // CSS px
          uniform float u_gapLen;      // CSS px
          out vec4 outColor;
          void main() {
            float period = max(1.0, u_dashLen + u_gapLen);
            float m = mod(max(v_css.x, 0.0), period);
            float a = m < u_dashLen ? 1.0 : 0.0;

            // Apply hole mask to remove dashes behind the label
            bool inHoleX = v_css.x >= v_holeRect.x && v_css.x <= (v_holeRect.x + v_holeRect.z);
            bool inHoleY = v_css.y >= v_holeRect.y && v_css.y <= (v_holeRect.y + v_holeRect.w);
            if (inHoleX && inHoleY) {
              a = 0.0;
            }

            outColor = vec4(v_color.rgb, v_color.a * a);
            if (outColor.a <= 0.0) discard;
          }
        `;
        this.octaveLineInstProgram = this._createProgram(octInstVS, octInstFS);
        // Cache uniforms for octaveLineInstProgram
        try {
          this._uniforms.octaveInst = this._uniforms.octaveInst || {};
          if (this.octaveLineInstProgram && this.gl) {
            const gl = this.gl;
            const p = this.octaveLineInstProgram;
            this._uniforms.octaveInst.u_viewport = gl.getUniformLocation(p, 'u_viewport');
            this._uniforms.octaveInst.u_dashLen  = gl.getUniformLocation(p, 'u_dashLen');
            this._uniforms.octaveInst.u_gapLen   = gl.getUniformLocation(p, 'u_gapLen');
          }
        } catch {}

        // Geometry: reuse unit quad if available, else create
        this.octaveLineInstVAO = gl.createVertexArray();
        gl.bindVertexArray(this.octaveLineInstVAO);

        // Unit quad (0..1) at location 0
        if (!this._octaveUnitBuffer) {
          this._octaveUnitBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, this._octaveUnitBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,1]), gl.STATIC_DRAW);
        } else {
          gl.bindBuffer(gl.ARRAY_BUFFER, this._octaveUnitBuffer);
        }
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(0, 0); // per-vertex

        // Instance pos/size (loc 1)
        this.octaveLineInstPosSizeBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstPosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1); // per-instance

        // Instance hole rect (loc 2)
        this.octaveLineInstHoleBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstHoleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(2, 1);

        // Instance color (loc 3)
        this.octaveLineInstColorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(3, 1);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }

      const count = (this._octaveIndices && this._octaveIndices.length) ? this._octaveIndices.length : 0;
      if (count <= 0) return;

      // Determine if rebuild/upload is required
      const needRebuild =
        (this._lastOctaveEpoch !== this._viewEpoch) ||
        (this._lastOctaveSelected !== this._selectedNoteIdForGuides) ||
        (this._lastOctaveRefFreq !== this._refFreqForGuides) ||
        (!this._octInstPosSize || this._octInstPosSize.length !== count * 4) ||
        (!this._octInstHole || this._octInstHole.length !== count * 4) ||
        (!this._octInstColor || this._octInstColor.length !== count * 4);

      if (needRebuild) {
        // Allocate CPU arrays
        if (!this._octInstPosSize || this._octInstPosSize.length !== count * 4) {
          this._octInstPosSize = new Float32Array(count * 4);
        }
        if (!this._octInstHole || this._octInstHole.length !== count * 4) {
          this._octInstHole = new Float32Array(count * 4);
        }
        if (!this._octInstColor || this._octInstColor.length !== count * 4) {
          this._octInstColor = new Float32Array(count * 4);
        }

        // Build per-instance data
        const xPad = 8.0;
        for (let i = 0; i < count; i++) {
          const k = this._octaveIndices[i];

          // Compute world y from frequency (ref * 2^k), where ref is BaseNote or selected note freq
          const ref = (typeof this._refFreqForGuides === 'number' && isFinite(this._refFreqForGuides))
            ? this._refFreqForGuides
            : (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
          const freq = ref * Math.pow(2, k);
          const yWorld = this._noteCenterY(freq);

          const localY = worldYToLocalCssY(yWorld);
          const yAligned = Math.floor(localY) + 0.5;

          // Label and hole rectangle
          const isPrimary = (k === 0);
          const label = isPrimary
            ? (this._selectedHasFrequencyForGuides && this._selectedNoteIdForGuides != null
                ? `Note [${this._selectedNoteIdForGuides}]`
                : 'BaseNote')
            : (k > 0 ? `+${k}` : `${k}`);

          const entry = this._createTextTexture(label);

          const holeX = xPad - 1.0;
          const holeY = (entry ? (yAligned - entry.hCss * 0.5) : (yAligned - 6.0)) - 1.0;
          const holeW = entry
            ? Math.min(entry.wCss + 2.0, Math.max(0.0, vpW - (xPad - 1.0) - 2.0))
            : 0.0;
          const holeH = (entry ? (entry.hCss + 2.0) : 12.0);

          // Fill arrays
          const o = i * 4;
          // Full-width 1px-high quad at yAligned; expand by 1px on both sides to avoid left-edge sliver
          this._octInstPosSize[o + 0] = -1.0;
          this._octInstPosSize[o + 1] = yAligned;
          this._octInstPosSize[o + 2] = vpW + 2.0;
          this._octInstPosSize[o + 3] = 1.0;

          this._octInstHole[o + 0] = holeX;
          this._octInstHole[o + 1] = holeY;
          this._octInstHole[o + 2] = holeW;
          this._octInstHole[o + 3] = holeH;

          const alpha = isPrimary ? 0.9 : 0.35;
          const ac = this._accentRgba(); // themed accent (horizontal octave/base guide lines)
          this._octInstColor[o + 0] = ac[0];
          this._octInstColor[o + 1] = ac[1];
          this._octInstColor[o + 2] = ac[2];
          this._octInstColor[o + 3] = alpha;
        }

        // Upload per-instance buffers (only when changed)
        gl.bindVertexArray(this.octaveLineInstVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstPosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._octInstPosSize, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstHoleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._octInstHole, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._octInstColor, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        // Update gating state
        this._lastOctaveEpoch = this._viewEpoch;
        this._lastOctaveSelected = this._selectedNoteIdForGuides;
        this._lastOctaveRefFreq = this._refFreqForGuides;
      }

      // Draw all lines in one instanced call
      if (!this.octaveLineInstProgram) return;
      gl.useProgram(this.octaveLineInstProgram);
      const Uoi = (this._uniforms && this._uniforms.octaveInst) ? this._uniforms.octaveInst : null;
      const uVP = Uoi ? Uoi.u_viewport : gl.getUniformLocation(this.octaveLineInstProgram, 'u_viewport');
      const uDash = Uoi ? Uoi.u_dashLen : gl.getUniformLocation(this.octaveLineInstProgram, 'u_dashLen');
      const uGap = Uoi ? Uoi.u_gapLen  : gl.getUniformLocation(this.octaveLineInstProgram, 'u_gapLen');
      if (uVP) gl.uniform2f(uVP, vpW, vpH);
      if (uDash) gl.uniform1f(uDash, 3.0);
      if (uGap) gl.uniform1f(uGap, 3.0);

      gl.bindVertexArray(this.octaveLineInstVAO);
      // Ensure no stale scissor state clips edges
      gl.disable(gl.SCISSOR_TEST);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, count);
      gl.bindVertexArray(null);

      // Draw labels per line (cached textures), centered vertically on the line
      if (this.textProgram && this.textVAO && this.textPosSizeBuffer) {
        gl.useProgram(this.textProgram);
        const Ut = (this._uniforms && this._uniforms.text) ? this._uniforms.text : null;
        const uVPt = Ut ? Ut.u_viewport : gl.getUniformLocation(this.textProgram, 'u_viewport');
        const uTint = Ut ? Ut.u_tint     : gl.getUniformLocation(this.textProgram, 'u_tint');
        const uTex  = Ut ? Ut.u_tex      : gl.getUniformLocation(this.textProgram, 'u_tex');
        if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
        if (uTex) gl.uniform1i(uTex, 0);

        // PMA-appropriate blend for text to prevent dulling over line/background
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        for (let i = 0; i < count; i++) {
          const k = this._octaveIndices[i];
          const isPrimary = (k === 0);
          const label = isPrimary
            ? (this._selectedHasFrequencyForGuides && this._selectedNoteIdForGuides != null
                ? `Note [${this._selectedNoteIdForGuides}]`
                : 'BaseNote')
            : (k > 0 ? `+${k}` : `${k}`);

          const entry = this._createTextTexture(label);
          if (!entry || !entry.tex) continue;

          if (uTint) {
            const tintA = isPrimary ? 1.0 : 0.9;
            gl.uniform4f(uTint, 1, 1, 1, tintA);
          }

          // Compute yAligned again consistently
          const ref = (typeof this._refFreqForGuides === 'number' && isFinite(this._refFreqForGuides))
            ? this._refFreqForGuides
            : (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
          const freq = ref * Math.pow(2, k);
          const yWorld = this._noteCenterY(freq);
          const localY = worldYToLocalCssY(yWorld);
          const yAligned = Math.floor(localY) + 0.5;

          const x = 8.0;
          const yTop = yAligned - entry.hCss * 0.5;
          const arr = new Float32Array([x, yTop, entry.wCss, entry.hCss]);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.tex);

          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        }

        // Restore default blending for non-text draws
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    };

    // Override the existing octave guides renderer to use the instanced path,
    // with safe fallback to original implementation if an error occurs.
    try {
      const _origOct = proto._renderOctaveGuides;
      proto._renderOctaveGuides = function () {
        try {
          return this._renderOctaveGuidesInstanced();
        } catch (e) {
          try { return _origOct.call(this); } catch {}
        }
      };
    } catch {}

  } catch (e) {
    // no-op
  }
})();
/* Link lines + drag overlay (dependency highlights, snap guides, ghost preview)
   - Adds a lightweight screen-space line renderer for cyan/magenta dependency edges
   - Adds drag overlay API for snap guides (vertical 1px lines) and a ghost fill over preview rect
   - Fully self-contained and appended to existing adapter via prototype augmentation
*/
(() => {
  try {
    if (typeof RendererAdapter === 'undefined') return;
    const proto = RendererAdapter.prototype;

    // Initialize link-line program/VAO and default flags lazily
    // Pooled endpoint writer. The dependency-line endpoints are rebuilt on every pointermove of
    // a drag (the anchor's centre moves, so every line hanging off it has to be re-laid), and
    // they used to be accumulated into plain JS arrays and then copied into fresh Float32Arrays.
    // At 5000 dependents that is a ~20,000-element boxed array plus an 80KB typed array per
    // property per frame — the garbage that produced the periodic multi-frame GC hitch.
    // These writers keep one growable Float32Array per bucket and hand out a subarray view, so a
    // steady-state drag allocates nothing. Views stay valid because a bucket is only rewritten
    // on a rebuild, and the caller re-reads the view on that same rebuild.
    proto._linkWriter = function (key) {
      const pool = this._linkPool || (this._linkPool = new Map<string, LinkWriter>());
      let w = pool.get(key);
      if (!w) {
        w = {
          a: new Float32Array(256),
          n: 0,
          _grow(need) {
            if (need <= this.a.length) return;
            let cap = this.a.length;
            while (cap < need) cap *= 2;
            const na = new Float32Array(cap);
            na.set(this.a.subarray(0, this.n));
            this.a = na;
          },
          // Endpoints push 4 values (x0,y0,x1,y1); flags push 2 (p0,p1). Both are always
          // finite numbers, so an undefined 3rd argument unambiguously means the 2-value form.
          push(v0, v1, v2, v3) {
            if (v2 === undefined) {
              this._grow(this.n + 2);
              this.a[this.n++] = v0; this.a[this.n++] = v1;
            } else {
              this._grow(this.n + 4);
              this.a[this.n++] = v0; this.a[this.n++] = v1;
              this.a[this.n++] = v2; this.a[this.n++] = v3!;
            }
          },
          get length() { return this.n; },
          view() { return this.n ? this.a.subarray(0, this.n) : null; }
        };
        pool.set(key, w);
      }
      w.n = 0;
      return w;
    };

    proto._initLinkLinesPass = function () {
      const gl = this.gl;
      if (!gl) return;

      // Default feature flags (ON by default unless explicitly set false earlier)
      if (typeof this.drawLinkLines === 'undefined') this.drawLinkLines = true;
      if (typeof this.drawDragOverlays === 'undefined') this.drawDragOverlays = true;
      if (typeof this.drawDragGhosts === 'undefined') this.drawDragGhosts = false;

      // Program already created?
      if (this.linkLineProgram && this.linkLineVAO) return;

      // Shader for screen-space thick line between endpoints (x0,y0)-(x1,y1) in CSS px
      const vs = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;        // (s,t) in [0,1]x[0,1]
        layout(location=1) in vec4 a_endpoints;   // (x0,y0,x1,y1) in canvas-local CSS px
        layout(location=2) in vec2 a_pFlags;      // (p0Drag, p1Drag) flags for horizontal GPU drag

        uniform vec2  u_viewport;                 // (canvas CSS w,h)
        uniform vec2 u_pan;                       // from the view that built these endpoints
        uniform float u_thickness;                // CSS px
        uniform float u_dragCssX;                 // CSS px horizontal drag offset

        void main() {
          vec2 p0 = a_endpoints.xy;
          vec2 p1 = a_endpoints.zw;
          // Apply horizontal drag offset to endpoints as requested by flags
          p0.x += a_pFlags.x * u_dragCssX;
          p1.x += a_pFlags.y * u_dragCssX;

          vec2 dir = p1 - p0;
          float len = max(length(dir), 1e-6);
          vec2 n = vec2(-dir.y, dir.x) / len;

          float s = a_unit.x;                        // along the line
          float t = (a_unit.y - 0.5) * u_thickness;  // across thickness centered at 0
          vec2 pos = mix(p0, p1, s) + n * t + u_pan;

          float ndcX = (pos.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (pos.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, -0.00003, 1.0);
        }
      `;
      const fs = `#version 300 es
        precision highp float;
        uniform vec4 u_color;
        out vec4 outColor;
        void main() { outColor = u_color; }
      `;
      this.linkLineProgram = this._createProgram(vs, fs);
      this._uniforms = this._uniforms || {};
      try {
        this._uniforms.linkLine = this._uniforms.linkLine || {};
        if (this.linkLineProgram) {
          this._uniforms.linkLine.u_viewport  = gl.getUniformLocation(this.linkLineProgram, "u_viewport");
          this._uniforms.linkLine.u_pan = gl.getUniformLocation(this.linkLineProgram, "u_pan");
          this._uniforms.linkLine.u_thickness = gl.getUniformLocation(this.linkLineProgram, "u_thickness");
          this._uniforms.linkLine.u_color     = gl.getUniformLocation(this.linkLineProgram, "u_color");
          this._uniforms.linkLine.u_dragCssX  = gl.getUniformLocation(this.linkLineProgram, "u_dragCssX");
        }
      } catch {}

      // Geometry/VAO (unit quad + per-instance endpoints)
      this.linkLineVAO = gl.createVertexArray();
      gl.bindVertexArray(this.linkLineVAO);

      // Unit quad (0,0)-(1,1)
      this._linkLineUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._linkLineUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      // Per-instance endpoints (x0,y0,x1,y1) in CSS px — maintain dual buffers for deps/rdeps
      this.linkLineEndpointsBufferDeps = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineEndpointsBufferDeps);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      this.linkLineEndpointsBufferRdeps = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineEndpointsBufferRdeps);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

      // Per-instance endpoint drag flags (p0,p1) — dual buffers for deps/rdeps at location 2
      this.linkLineFlagsBufferDeps = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineFlagsBufferDeps);
      gl.bufferData(gl.ARRAY_BUFFER, 2 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      this.linkLineFlagsBufferRdeps = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineFlagsBufferRdeps);
      gl.bufferData(gl.ARRAY_BUFFER, 2 * 4, gl.DYNAMIC_DRAW);

      // Property-colored link line buffers (rdeps split by property)
      this._linkBuffersByProperty = {};
      for (const prop of ['frequency', 'startTime', 'duration'] as const) {
        this._linkBuffersByProperty[prop] = {
          endpoints: gl.createBuffer(),
          flags: gl.createBuffer()
        };
        gl.bindBuffer(gl.ARRAY_BUFFER, this._linkBuffersByProperty[prop].endpoints);
        gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._linkBuffersByProperty[prop].flags);
        gl.bufferData(gl.ARRAY_BUFFER, 2 * 4, gl.DYNAMIC_DRAW);
      }

      // Property-colored link line buffers (deps split by property)
      this._linkDepsBuffersByProperty = {};
      for (const prop of ['frequency', 'startTime', 'duration'] as const) {
        this._linkDepsBuffersByProperty[prop] = {
          endpoints: gl.createBuffer(),
          flags: gl.createBuffer()
        };
        gl.bindBuffer(gl.ARRAY_BUFFER, this._linkDepsBuffersByProperty[prop].endpoints);
        gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._linkDepsBuffersByProperty[prop].flags);
        gl.bufferData(gl.ARRAY_BUFFER, 2 * 4, gl.DYNAMIC_DRAW);
      }

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // CPU caches
      this._linkEndpointsDeps  = null;
      this._linkEndpointsRdeps = null;
      this._dragOverlay = this._dragOverlay || null;
    };

    // Public API called by Workspace during interaction preview frames
    proto.setDragOverlay = function (state) {
      try {
        this._dragOverlay = (state && state.noteId != null)
          ? {
              noteId: Number(state.noteId),
              type: String(state.type || ''),
              dxSec: (state.dxSec != null ? Number(state.dxSec) : 0),
              ddurSec: (state.ddurSec != null ? Number(state.ddurSec) : 0),
              // Persist original start/duration (in seconds) for origin guide bars
              origStartSec: (state.origStartSec != null ? Number(state.origStartSec) : null),
              origDurationSec: (state.origDurationSec != null ? Number(state.origDurationSec) : null)
            }
          : null;
        // Track moving dependents (ids) when provided to filter link lines during preview.
        // This is called on every pointermove, and .map() + new Set() over a few thousand
        // dependents each time is exactly the churn that makes long drags hitch. The moving set
        // does not change during a drag, so rebuild it only when the caller's array actually
        // differs (identity first, then a size check).
        if (this._dragOverlay && state && Array.isArray(state.movingIds)) {
          const ids = state.movingIds;
          // Identity first (free when the caller reuses its array), then an exact content
          // check — O(n) Set lookups, but no allocation. A size-only test would be unsound.
          let unchanged = (ids === this._dragOverlayIdsRef) && !!this._dragMovingIds;
          if (!unchanged && this._dragMovingIds && this._dragMovingIds.size === ids.length) {
            unchanged = true;
            for (let i = 0; i < ids.length; i++) {
              if (!this._dragMovingIds.has(Number(ids[i]))) { unchanged = false; break; }
            }
          }
          if (!unchanged) {
            try {
              const s = new Set<number>();
              for (let i = 0; i < ids.length; i++) s.add(Number(ids[i]));
              this._dragMovingIds = s;
            } catch { this._dragMovingIds = null; }
          }
          this._dragOverlayIdsRef = ids;
        } else if (!this._dragOverlay) {
          this._dragMovingIds = null;
          this._dragOverlayIdsRef = null;
        }
        this.needsRedraw = true;
      } catch {
        this._dragOverlay = null;
        this._dragMovingIds = null;
        this.needsRedraw = true;
      }
    };
    proto.clearDragOverlay = function () {
      try {
        this._dragOverlay = null;
        this._dragMovingIds = null;
        this.needsRedraw = true;
      } catch {
        this._dragOverlay = null;
        this._dragMovingIds = null;
        this.needsRedraw = true;
      }
    };

    // Build dependency endpoints (CSS px) and draw lines + drag overlays
    proto._renderDependencyLinesAndDragOverlay = function () {
      const gl = this.gl, canvas = this.canvas;
      if (!gl || !canvas) return;

      // Instance-indexed reads below only run for a synchronized note body.
      const positions = this.posSize!;
      // Ensure link-line resources exist
      try { this._initLinkLinesPass(); } catch {}

      const rectCss = canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      const toLocalCss = (wx: number, wy: number) => {
        // world -> page CSS
        const sx = this.matrix[0] * wx + this.matrix[3] * wy + this.matrix[6];
        const sy = this.matrix[1] * wx + this.matrix[4] * wy + this.matrix[7];
        // page -> canvas-local CSS
        return {
          x: (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx,
          y: (this.canvasOffset?.y != null) ? (sy - this.canvasOffset.y) : sy
        };
      };
      // Screen-space horizontal drag delta in CSS px used to keep CPU-derived endpoints in sync
      const dxCssDrag = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);

      // Draw dependency link lines (cyan for deps, magenta for rdeps)
      try {
        // Draw link lines during drag as well; endpoint rebuild uses cached moving set
        const suppressLinkLines = false;
        if (!suppressLinkLines && this.drawLinkLines && this.linkLineProgram && this.linkLineVAO && this._noteIdToIndex && ((this._dragOverlay && this._dragOverlay.noteId != null) || (this._lastSelectedNoteId != null))) {
          const anchorId = (this._dragOverlay && this._dragOverlay.noteId != null) ? this._dragOverlay.noteId : this._lastSelectedNoteId;
          const selIdx = (this._noteIdToIndex && this._noteIdToIndex.get) ? this._noteIdToIndex.get(anchorId!) : null;
          let selC = null;

          // Resolve anchor center in canvas-local CSS px for: BaseNote (0), normal note ids, and measure triangle ids.
          if (anchorId === 0) {
              // Suppress link lines when BaseNote is selected
              selC = null;
              // Clear endpoints on anchor change to avoid stale lines
              const __anchorChanged = (this._lastLinkAnchorId !== anchorId) || (this._lastLinkViewEpoch !== this._viewEpoch) || (this._lastLinkPosEpoch !== this._posEpoch) || (this._lastLinkTriDataEpoch !== this._triDataEpoch) || (this._lastLinkProspectiveParentId !== this._prospectiveParentId) || (this._lastLinkDragEpoch !== this._dragEpoch);
              if (__anchorChanged) {
                this._linkEndpointsDeps = new Float32Array(0);
                this._linkEndpointsRdeps = new Float32Array(0);
                this._linkDepsCount = 0;
                this._linkRdepsCount = 0;
                this._lastLinkAnchorId = anchorId;
                this._lastLinkViewEpoch = this._viewEpoch;
                this._lastLinkPosEpoch = this._posEpoch;
                this._lastLinkDragEpoch = this._dragEpoch;
                this._lastLinkTriDataEpoch = this._triDataEpoch;
                this._lastLinkProspectiveParentId = this._prospectiveParentId;
              }
            } else if (selIdx != null && selIdx >= 0 && selIdx < this.instanceCount) {
            // Anchor is a normal note rectangle
            const baseSel = selIdx * 4;
            const sxW = positions[baseSel + 0], syW = positions[baseSel + 1];
            const sw  = positions[baseSel + 2], sh  = positions[baseSel + 3];
            selC = toLocalCss(sxW + 0.5 * sw, syW + 0.5 * sh);
          } else {
            // Anchor may be a measure triangle; use its apex (top center)
            const idNum = Number(anchorId);
            const triIdx = (this._measureTriIdToIndex && this._measureTriIdToIndex.get)
              ? this._measureTriIdToIndex.get(idNum)
              : (this._measureTriIds && this._measureTriIds.indexOf ? this._measureTriIds.indexOf(idNum) : -1);
            if (triIdx != null && triIdx >= 0 && this.measureTriPosSize && this.measureTriPosSize.length >= (triIdx + 1) * 4) {
              const o = triIdx * 4;
              const left = this.measureTriPosSize[o + 0];
              const top  = this.measureTriPosSize[o + 1];
              const w    = this.measureTriPosSize[o + 2];
              selC = { x: left + w * 0.5, y: top };
            }
          }

          // Check if we need to rebuild endpoints (epoch-gated to avoid redundant CPU work)
          const anchorChanged = (this._lastLinkAnchorId !== anchorId);
          // A pan translates every note endpoint equally. Measure markers can
          // be screen-anchored vertically, so rebuild for vertical moves there.
          const basis = this._linkBasis, m = this.matrix;
          const tx = m[6] - this.canvasOffset.x, ty = m[7] - this.canvasOffset.y;
          const translate = basis && !this._dragActive && basis.config === this._config &&
            basis.sx === m[0] && basis.sy === m[4] && basis.b === m[1] && basis.c === m[3] &&
            basis.w === vpW && basis.h === vpH && (!this._measureTriIds?.length || basis.ty === ty);
          const viewChanged = this._lastLinkViewEpoch !== this._viewEpoch && !translate;
          const posChanged    = (this._lastLinkPosEpoch !== this._posEpoch);
          const prosChanged   = (this._lastLinkProspectiveParentId !== this._prospectiveParentId);
          const triChanged    = (this._lastLinkTriDataEpoch !== this._triDataEpoch);
          // A drag deliberately does not bump _posEpoch, but it DOES rewrite the anchor's
          // posSize each pointermove, so the line endpoints hanging off the dragged note are
          // stale without this. (The moving dependents' ends are shifted on the GPU.)
          const dragChanged   = (this._lastLinkDragEpoch !== this._dragEpoch);
          const needsRebuild = anchorChanged || viewChanged || posChanged || prosChanged || triChanged || dragChanged;

          if (selC && needsRebuild) {
            const buildEndpoints = (indices: number[] | null) => {
              if (!indices || !indices.length) return null;
              const arr = new Float32Array(indices.length * 4);
              let k = 0;
              for (let i = 0; i < indices.length; i++) {
                const idx = indices[i];
                if (idx == null || idx < 0 || idx >= this.instanceCount) continue;
                const o = idx * 4;
                const xw = positions[o + 0], yw = positions[o + 1];
                const ww = positions[o + 2], hh = positions[o + 3];
                const c  = toLocalCss(xw + 0.5 * ww, yw + 0.5 * hh);
                arr[k++] = selC.x; arr[k++] = selC.y;
                arr[k++] = c.x;    arr[k++] = c.y;
              }
              return (k === arr.length) ? arr : arr.slice(0, k);
            };

            // Prefer live sets for the anchor (dragged or selected) using moduleRef; fallback to cached sets
            // Extend endpoints to cover measure triangles and BaseNote in addition to notes.
            try {
              const mref = this._moduleRef;
              const movingSet = this._dragMovingIds || null;

               // Is anchor moving (and not preview-baked if it is a measure)?
               const anchorIdNum = Number(anchorId);
               let movingAnchor = false;
               try {
                 const isMeasureAnchor = !!(this._measureTriIdToIndex && this._measureTriIdToIndex.get && this._measureTriIdToIndex.get(anchorIdNum) != null && (this._measureTriIdToIndex.get(anchorIdNum) ?? -1) >= 0);
                 const anchorHasPrev = !!(this._measurePreview && Object.prototype.hasOwnProperty.call(this._measurePreview, anchorIdNum));
                 // Only treat the anchor as moving in the shader for MEASURE anchors without a preview-baked position.
                 // For normal notes, the anchor's CPU posSize is already updated during preview, so shader offset would double-apply.
                 movingAnchor = !!(this._dragActive && movingSet && movingSet.has(anchorIdNum) && isMeasureAnchor && !anchorHasPrev);
               } catch {}

              // Helpers to append endpoints and parallel GPU pFlags lists ([p0Drag, p1Drag])
              const appendNoteIdxEndpoints = (indices: number[] | null, list: LinkWriter, flagsList: LinkWriter) => {
                if (!indices || !indices.length) return;
                for (let i = 0; i < indices.length; i++) {
                  const idx = indices[i];
                  if (idx == null || idx < 0 || idx >= this.instanceCount) continue;
                  const o = idx * 4;
                  let xw = positions[o + 0], yw = positions[o + 1];
                  let ww = positions[o + 2], hh = positions[o + 3];
                  // Do not apply CPU drag offsets here; the link-line shader applies u_dragCssX via per-endpoint flags.
                  const c  = toLocalCss(xw + 0.5 * ww, yw + 0.5 * hh);
                  list.push(selC.x, selC.y, c.x, c.y);
                  // p0 is anchor endpoint, p1 is target note endpoint
                  let targetId = (this._instanceNoteIds && this._instanceNoteIds[idx] != null) ? Number(this._instanceNoteIds[idx]) : null;
                  const targetMoving = !!(movingSet && targetId != null && movingSet.has(targetId));
                  flagsList.push(movingAnchor ? 1.0 : 0.0, targetMoving ? 1.0 : 0.0);
                }
              };
              const appendMeasureIdEndpoints = (ids: number[] | null, list: LinkWriter, flagsList: LinkWriter) => {
                if (!ids || !ids.length) return;
                if (!this.measureTriPosSize || (!this._measureTriIdToIndex && !this._measureTriIds)) return;
                for (let i = 0; i < ids.length; i++) {
                  const mid = Number(ids[i]);
                  if (!(mid >= 0)) continue;
                  const triIdx = (this._measureTriIdToIndex && this._measureTriIdToIndex.get)
                    ? this._measureTriIdToIndex.get(mid)
                    : (this._measureTriIds && this._measureTriIds.indexOf ? this._measureTriIds.indexOf(mid) : -1);
                  if (triIdx == null || triIdx < 0) continue;
                  const o = triIdx * 4;
                  if (o + 3 >= this.measureTriPosSize.length) continue;
                  const left = this.measureTriPosSize[o + 0];
                  const top  = this.measureTriPosSize[o + 1];
                  const w    = this.measureTriPosSize[o + 2];
                  // Apex (top middle) in CSS px (already canvas-local)
                  const ax = left + w * 0.5;
                  const ay = top;
                  list.push(selC.x, selC.y, ax, ay);
                  // p0 anchor, p1 target measure
                  const hasPrev = !!(this._measurePreview && Object.prototype.hasOwnProperty.call(this._measurePreview, mid));
                  const targetMoving = !!(movingSet && movingSet.has(mid) && !hasPrev);
                  flagsList.push(movingAnchor ? 1.0 : 0.0, targetMoving ? 1.0 : 0.0);
                }
              };
              const appendBaseEndpointIf = (flag: boolean, list: LinkWriter, flagsList: LinkWriter) => {
                if (!flag) return;
                // Use cached CSS center if available; fallback to world->CSS
                let bx = null, by = null;
                if (this._baseCircleCss && isFinite(this._baseCircleCss.cx) && isFinite(this._baseCircleCss.cy)) {
                  bx = this._baseCircleCss.cx;
                  by = this._baseCircleCss.cy;
                } else {
                  const baseFreq = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
                  const xCenterWorld = -30.0;
                  const yCenterWorld = this._noteCenterY(baseFreq);
                  const bc = toLocalCss(xCenterWorld, yCenterWorld);
                  bx = bc.x; by = bc.y;
                }
                if (bx != null && by != null) {
                  list.push(selC.x, selC.y, bx, by);
                  // BaseNote never drags; only anchor might
                  flagsList.push(movingAnchor ? 1.0 : 0.0, 0.0);
                }
              };

              // 1) Dependencies (property-colored):
              // Build separate endpoint lists for each property type (what this note's expressions reference)
              const depsListByProp = { frequency: this._linkWriter('dl:f'), startTime: this._linkWriter('dl:s'), duration: this._linkWriter('dl:d') };
              const depsFlagsByProp = { frequency: this._linkWriter('df:f'), startTime: this._linkWriter('df:s'), duration: this._linkWriter('df:d') };

              // Helper to check if an ID is a measure note (used by both parent chains and children trees)
              const isMeasureNoteId = (id: number) => {
                try {
                  const n = mref?.getNoteById?.(Number(id));
                  return isMeasureNote(n);
                } catch { return false; }
              };

              // Helper to get center point for a note/measure/baseNote (used by both parent chains and children trees)
              const getCenterForId = (id: number) => {
                const numId = Number(id);
                if (numId === 0) {
                  // baseNote
                  if (this._baseCircleCss && isFinite(this._baseCircleCss.cx) && isFinite(this._baseCircleCss.cy)) {
                    return { x: this._baseCircleCss.cx, y: this._baseCircleCss.cy };
                  }
                  const baseFreq = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
                  const xCenterWorld = -30.0;
                  const yCenterWorld = this._noteCenterY(baseFreq);
                  return toLocalCss(xCenterWorld, yCenterWorld);
                }
                if (this._measureTriIdToIndex?.has(numId)) {
                  // measure triangle
                  const triIdx = (this._measureTriIdToIndex && this._measureTriIdToIndex.get)
                    ? this._measureTriIdToIndex.get(numId)
                    : (this._measureTriIds && this._measureTriIds.indexOf ? this._measureTriIds.indexOf(numId) : -1);
                  if (triIdx != null && triIdx >= 0 && this.measureTriPosSize && this.measureTriPosSize.length >= (triIdx + 1) * 4) {
                    const o = triIdx * 4;
                    const left = this.measureTriPosSize[o + 0];
                    const top  = this.measureTriPosSize[o + 1];
                    const w    = this.measureTriPosSize[o + 2];
                    return { x: left + w * 0.5, y: top };
                  }
                  return null;
                }
                // regular note
                const idx = this._noteIdToIndex.get(numId);
                if (idx == null || idx < 0 || idx >= this.instanceCount) return null;
                const o = idx * 4;
                const xw = positions[o + 0], yw = positions[o + 1];
                const ww = positions[o + 2], hh = positions[o + 3];
                return toLocalCss(xw + 0.5 * ww, yw + 0.5 * hh);
              };

              // During drag, show full parent chain starting from prospective parent
              // But for measure anchors dragging right, don't switch parent (keep existing chain)
              let prospectiveParentId = null;
              if (this._dragOverlay && this._prospectiveParentId != null) {
                const st = this._dragOverlay;
                const pid = this._prospectiveParentId;
                let usePros = true;

                // When dragging a measure triangle to the right, don't switch to prospective parent
                if (st.type === 'move' && Number(st.dxSec) > 0) {
                  try {
                    const n = mref?.getNoteById?.(Number(anchorId));
                    const isMeasureAnchor = isMeasureNote(n);
                    if (isMeasureAnchor) usePros = false;
                  } catch {}
                }

                // Avoid degenerate self-parent case
                if (Number(pid) === Number(anchorId)) usePros = false;

                if (usePros) prospectiveParentId = pid;
              }

              if (mref && typeof mref.getParentChainByProperty === 'function') {
                // Use full parent chain for segmented line visualization
                // Each chain is: [parent1, parent2, ..., baseNote] (excluding selected note)
                // We draw connected segments: selected → parent1 → parent2 → ... → baseNote
                // During drag, for startTime we use the prospective parent and then continue its chain

                for (const prop of ['frequency', 'startTime', 'duration'] as const) {
                  let chain;

                  // During drag, use prospective parent for startTime chain
                  if (prop === 'startTime' && prospectiveParentId != null) {
                    // Build chain: [prospectiveParent, ...prospectiveParent's chain]
                    const prospectiveChain = (prospectiveParentId === 0)
                      ? [0] // baseNote is the end
                      : [prospectiveParentId, ...mref.getParentChainByProperty(Number(prospectiveParentId), prop)];
                    chain = prospectiveChain;
                  } else {
                    chain = mref.getParentChainByProperty(Number(anchorId), prop);
                  }

                  if (!chain || chain.length === 0) continue;

                  // Build connected segments: selected → chain[0] → chain[1] → ... → chain[n-1]
                  // First segment: from selected note (selC) to first chain element
                  let prevCenter = { x: selC.x, y: selC.y };
                  let prevMoving = movingAnchor;

                  for (let i = 0; i < chain.length; i++) {
                    const curId = chain[i];
                    const curCenter = getCenterForId(curId);
                    if (!curCenter) continue;

                    // Add segment from prev to cur
                    depsListByProp[prop].push(prevCenter.x, prevCenter.y, curCenter.x, curCenter.y);

                    // Compute moving flags
                    const curMoving = !!(movingSet && movingSet.has(Number(curId)));
                    depsFlagsByProp[prop].push(prevMoving ? 1.0 : 0.0, curMoving ? 1.0 : 0.0);

                    // Update prev for next segment
                    prevCenter = curCenter;
                    prevMoving = curMoving;
                  }
                }

              } else {
                // Fallback: use old logic, put everything in startTime
                const buildFromStartString = () => {
                  const out: { noteIds: number[]; measureIds: number[]; hasBase: boolean; parsed: boolean } = { noteIds: [], measureIds: [], hasBase: false, parsed: false };
                  try {
                    const mod = this._moduleRef || null;
                    if (!mod || typeof mod.getNoteById !== 'function') return out;
                    const n = mod.getNoteById(Number(anchorId));
                    const s = n?.variables?.startTimeString || '';
                    if (!s || typeof s !== 'string') return out;

                    out.parsed = true;

                    out.hasBase = /\bbase\./.test(s);

                    const seen = new Set<number>();
                    // Note refs: [N].t, [N].d
                    const dslRe = /\[(\d+)\]\./g;
                    let dm;
                    while ((dm = dslRe.exec(s))) {
                      const id = Number(dm[1]);
                      if (!isFinite(id) || id === 0) continue;
                      if (id === Number(anchorId) || seen.has(id)) continue;
                      seen.add(id);
                      try {
                        const ref = mod.getNoteById(id);
                        const isMeasure = isMeasureNote(ref);
                        if (isMeasure) out.measureIds.push(id);
                        else out.noteIds.push(id);
                      } catch {
                        out.noteIds.push(id);
                      }
                    }
                  } catch {}
                  return out;
                };

                const depsList = this._linkWriter('dlfb');
                const depsFlags = this._linkWriter('dffb');
                const liveParsed = buildFromStartString();

                if (liveParsed.parsed) {
                  const idxs = liveParsed.noteIds
                    .map(id => this._noteIdToIndex.get(Number(id)))
                    .filter((ii): ii is number => ii != null && ii >= 0 && ii < this.instanceCount);
                  appendNoteIdxEndpoints(idxs, depsList, depsFlags);
                  appendMeasureIdEndpoints(liveParsed.measureIds, depsList, depsFlags);
                  appendBaseEndpointIf(liveParsed.hasBase, depsList, depsFlags);
                } else if (mref && typeof mref.getDirectDependencies === 'function') {
                  const isMeasureNoteId = (id: number) => {
                    try {
                      const n = mref.getNoteById(Number(id));
                      return isMeasureNote(n);
                    } catch { return false; }
                  };
                  const d = mref.getDirectDependencies(Number(anchorId)) || [];
                  const noteIds = [];
                  const measureIds = [];
                  let hasBase = false;
                  for (const idRaw of d) {
                    const id = Number(idRaw);
                    if (id === 0) { hasBase = true; continue; }
                    if (isMeasureNoteId(id)) { measureIds.push(id); continue; }
                    noteIds.push(id);
                  }
                  const idxs = noteIds
                    .map(id => this._noteIdToIndex.get(Number(id)))
                    .filter((ii): ii is number => ii != null && ii >= 0 && ii < this.instanceCount);
                  appendNoteIdxEndpoints(idxs, depsList, depsFlags);
                  appendMeasureIdEndpoints(measureIds, depsList, depsFlags);
                  appendBaseEndpointIf(hasBase, depsList, depsFlags);
                } else {
                  appendNoteIdxEndpoints(this._relDepsIdx, depsList, depsFlags);
                  appendMeasureIdEndpoints(this._relDepsMeasureIds, depsList, depsFlags);
                  appendBaseEndpointIf(this._relDepsHasBase, depsList, depsFlags);
                }

                // Put in startTime for fallback
                depsListByProp.startTime = depsList;
                depsFlagsByProp.startTime = depsFlags;
              }

              // Store property-colored deps arrays
              var depsArrByProp: Partial<ByRelation<Float32Array<ArrayBuffer> | null>> | undefined = {};
              var depsFlagsArrByProp: Partial<ByRelation<Float32Array<ArrayBuffer> | null>> | undefined = {};
              for (const prop of ['frequency', 'startTime', 'duration'] as const) {
                depsArrByProp[prop] = depsListByProp[prop].view();
                depsFlagsArrByProp[prop] = depsFlagsByProp[prop].view();
              }

              // 2) Dependents (property-colored):
              // Build separate endpoint lists for each property type
              const rdepsListByProp = { frequency: this._linkWriter('rl:f'), startTime: this._linkWriter('rl:s'), duration: this._linkWriter('rl:d') };
              const rdepsFlagsByProp = { frequency: this._linkWriter('rf:f'), startTime: this._linkWriter('rf:s'), duration: this._linkWriter('rf:d') };

              if (mref && typeof mref.getChildrenTreeByAllProperties === 'function') {
                // Use batched tree traversal (single BFS instead of 3 separate calls).
                // Cached: this is a pure function of the anchor and the module's dependency
                // STRUCTURE, and a drag changes neither — it only moves notes. Re-running the
                // BFS on every pointermove rebuilt an edge object per dependent per property
                // (tens of thousands of objects per frame with a 5000-dependent hub), which is
                // what kept triggering GC mid-drag. Both epochs in the key are bumped by sync(),
                // so any real change to the module still invalidates it.
                const allTrees = this._selectionTrees(mref, Number(anchorId));

                for (const prop of ['frequency', 'startTime', 'duration'] as const) {
                  const edges = allTrees?.edgesByProperty[prop] || [];
                  if (!edges?.length) continue;

                  // At overview scales many siblings end in the same pixel.
                  // One segment represents those coincident paths; the full tree
                  // and its per-note rings still retain every relationship.
                  const siblings = edges.length > 2048 && !this._dragActive &&
                    (this.xScalePxPerWU < 1 || this.currentXScaleFactor < 1) ? new Map<number, Set<number>>() : null;
                  let lastParent = null, parentCenter = null;
                  for (const edge of edges) {
                    // During drag, only include edges where child is in the moving set
                    if (movingSet && !movingSet.has(edge.childId)) continue;

                    if (edge.parentId !== lastParent) {
                      parentCenter = getCenterForId(edge.parentId);
                      lastParent = edge.parentId;
                      siblings?.clear();
                    }
                    const childCenter = getCenterForId(edge.childId);
                    if (!parentCenter || !childCenter) continue;
                    if (siblings) {
                      const x = Math.round(childCenter.x), y = Math.round(childCenter.y);
                      let row = siblings.get(y);
                      if (!row) siblings.set(y, row = new Set());
                      if (row.has(x)) continue;
                      row.add(x);
                    }

                    // Add segment from parent to child
                    rdepsListByProp[prop].push(parentCenter.x, parentCenter.y, childCenter.x, childCenter.y);

                    // Compute moving flags for drag preview
                    const parentMoving = edge.parentId === Number(anchorId)
                      ? movingAnchor
                      : !!(movingSet && movingSet.has(edge.parentId));
                    const childMoving = !!(movingSet && movingSet.has(edge.childId));
                    rdepsFlagsByProp[prop].push(parentMoving ? 1.0 : 0.0, childMoving ? 1.0 : 0.0);
                  }
                }
              } else if (mref && typeof mref.getChildrenTreeByProperty === 'function') {
                // Fallback to individual calls for backwards compatibility
                for (const prop of ['frequency', 'startTime', 'duration'] as const) {
                  const tree = mref.getChildrenTreeByProperty(Number(anchorId), prop);
                  if (!tree?.edges?.length) continue;

                  for (const edge of tree.edges) {
                    if (movingSet && !movingSet.has(edge.childId)) continue;
                    const parentCenter = getCenterForId(edge.parentId);
                    const childCenter = getCenterForId(edge.childId);
                    if (!parentCenter || !childCenter) continue;
                    rdepsListByProp[prop].push(parentCenter.x, parentCenter.y, childCenter.x, childCenter.y);
                    const parentMoving = edge.parentId === Number(anchorId)
                      ? movingAnchor
                      : !!(movingSet && movingSet.has(edge.parentId));
                    const childMoving = !!(movingSet && movingSet.has(edge.childId));
                    rdepsFlagsByProp[prop].push(parentMoving ? 1.0 : 0.0, childMoving ? 1.0 : 0.0);
                  }
                }
              } else if (mref && typeof mref.getDependentsByProperty === 'function') {
                // Fallback: Use property-colored dependents with star pattern
                const propDeps = mref.getDependentsByProperty(Number(anchorId));

                // Helper to check if an ID is a measure note
                const isMeasureNoteIdRdeps = (id: number) => {
                  try {
                    const n = mref.getNoteById(Number(id));
                    return isMeasureNote(n);
                  } catch { return false; }
                };

                for (const prop of ['frequency', 'startTime', 'duration'] as const) {
                  const propIds = propDeps[prop] || [];
                  const filteredIds = movingSet ? propIds.filter(id => movingSet.has(Number(id))) : propIds;

                  // Separate note IDs from measure IDs
                  const noteIdsRdeps = [];
                  const measureIdsRdeps = [];
                  for (const id of filteredIds) {
                    const numId = Number(id);
                    if (numId === 0) continue; // baseNote handled separately if needed
                    if (isMeasureNoteIdRdeps(numId)) {
                      measureIdsRdeps.push(numId);
                    } else {
                      noteIdsRdeps.push(numId);
                    }
                  }

                  // Add note endpoints
                  const propIdxs = noteIdsRdeps
                    .map(id => this._noteIdToIndex.get(Number(id)))
                    .filter((ii): ii is number => ii != null && ii >= 0 && ii < this.instanceCount);
                  appendNoteIdxEndpoints(propIdxs, rdepsListByProp[prop], rdepsFlagsByProp[prop]);

                  // Add measure endpoints
                  appendMeasureIdEndpoints(measureIdsRdeps, rdepsListByProp[prop], rdepsFlagsByProp[prop]);
                }
              } else if (mref && typeof mref.getDependentNotes === 'function') {
                // Fallback: put all in startTime (teal) for backwards compatibility
                const isMeasureNoteIdFallback = (id: number) => {
                  try {
                    const n = mref.getNoteById(Number(id));
                    return isMeasureNote(n);
                  } catch { return false; }
                };
                const rRaw = mref.getDependentNotes(Number(anchorId)) || [];
                const rawFiltered = movingSet ? rRaw.filter(id => movingSet.has(Number(id))) : rRaw;

                const noteIds = [];
                const measureIds = [];
                let hasBase = false;
                for (const idRaw of rawFiltered) {
                  const id = Number(idRaw);
                  if (id === 0) { hasBase = true; continue; }
                  if (isMeasureNoteIdFallback(id)) { measureIds.push(id); continue; }
                  noteIds.push(id);
                }
                const idxsR = noteIds
                  .map(id => this._noteIdToIndex.get(Number(id)))
                  .filter((ii): ii is number => ii != null && ii >= 0 && ii < this.instanceCount);
                appendNoteIdxEndpoints(idxsR, rdepsListByProp.startTime, rdepsFlagsByProp.startTime);
                appendMeasureIdEndpoints(measureIds, rdepsListByProp.startTime, rdepsFlagsByProp.startTime);
                appendBaseEndpointIf(hasBase, rdepsListByProp.startTime, rdepsFlagsByProp.startTime);
              } else {
                // Use cached indices, put in startTime for backwards compatibility
                if (movingSet && this._relRdepsIdx && this._instanceNoteIds) {
                  const idxsAlt = this._relRdepsIdx.filter(idx => {
                    const idAtIdx = this._instanceNoteIds && this._instanceNoteIds[idx];
                    return movingSet.has(Number(idAtIdx));
                  });
                  appendNoteIdxEndpoints(idxsAlt, rdepsListByProp.startTime, rdepsFlagsByProp.startTime);
                } else {
                  appendNoteIdxEndpoints(this._relRdepsIdx, rdepsListByProp.startTime, rdepsFlagsByProp.startTime);
                }
                appendMeasureIdEndpoints(this._relRdepsMeasureIds, rdepsListByProp.startTime, rdepsFlagsByProp.startTime);
                appendBaseEndpointIf(this._relRdepsHasBase, rdepsListByProp.startTime, rdepsFlagsByProp.startTime);
              }

              // Store property-colored arrays
              var rdepsArrByProp: Partial<ByRelation<Float32Array<ArrayBuffer> | null>> | undefined = {};
              var rdepsFlagsArrByProp: Partial<ByRelation<Float32Array<ArrayBuffer> | null>> | undefined = {};
              for (const prop of ['frequency', 'startTime', 'duration'] as const) {
                rdepsArrByProp[prop] = rdepsListByProp[prop].view();
                rdepsFlagsArrByProp[prop] = rdepsFlagsByProp[prop].view();
              }

            } catch {}

            // Counts, derived from the per-property arrays that are actually drawn.
            // The combined deps/rdeps arrays that used to live here were never rendered from —
            // only the per-property buffers are (see the draw loops below). Building them meant
            // concatenating boxed JS arrays with push(...spread) and minting four more
            // Float32Arrays, every pointermove; at 5000 dependents that was hundreds of KB of
            // garbage per frame and the main source of the GC hitches when dragging a hub note.
            // Only these two counts were ever read from them, and only as a "is there anything
            // to draw" gate, so they are summed from the real buffers instead.
            const countOf = (byProp: Partial<ByRelation<Float32Array<ArrayBuffer> | null>> | undefined) => {
              let n = 0;
              for (const prop of ['frequency', 'startTime', 'duration'] as const) {
                const a = byProp && byProp[prop];
                if (a && a.length) n += Math.floor(a.length / 4);
              }
              return n;
            };
            this._linkDepsCount  = countOf(depsArrByProp);
            this._linkRdepsCount = countOf(rdepsArrByProp);

            gl.bindVertexArray(this.linkLineVAO);

            // Upload property-colored rdeps buffers
            for (const prop of ['frequency', 'startTime', 'duration'] as const) {
              const propArr = rdepsArrByProp?.[prop];
              const propFlags = rdepsFlagsArrByProp?.[prop];
              const count = propArr ? Math.max(0, Math.floor(propArr.length / 4)) : 0;
              this._linkCountByProperty[prop] = count;
              this._linkEndpointsByProperty[prop] = propArr;
              this._linkFlagsByProperty[prop] = propFlags;

              if (count > 0 && this._linkBuffersByProperty?.[prop]) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this._linkBuffersByProperty[prop].endpoints);
                gl.bufferData(gl.ARRAY_BUFFER, propArr!, gl.DYNAMIC_DRAW);
                if (propFlags) {
                  gl.bindBuffer(gl.ARRAY_BUFFER, this._linkBuffersByProperty[prop].flags);
                  gl.bufferData(gl.ARRAY_BUFFER, propFlags, gl.DYNAMIC_DRAW);
                }
              }
            }

            // Upload property-colored deps buffers
            for (const prop of ['frequency', 'startTime', 'duration'] as const) {
              const propArr = depsArrByProp?.[prop];
              const propFlags = depsFlagsArrByProp?.[prop];
              const count = propArr ? Math.max(0, Math.floor(propArr.length / 4)) : 0;
              this._linkDepsCountByProperty[prop] = count;
              this._linkDepsEndpointsByProperty[prop] = propArr;
              this._linkDepsFlagsByProperty[prop] = propFlags;

              if (count > 0 && this._linkDepsBuffersByProperty?.[prop]) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this._linkDepsBuffersByProperty[prop].endpoints);
                gl.bufferData(gl.ARRAY_BUFFER, propArr!, gl.DYNAMIC_DRAW);
                if (propFlags) {
                  gl.bindBuffer(gl.ARRAY_BUFFER, this._linkDepsBuffersByProperty[prop].flags);
                  gl.bufferData(gl.ARRAY_BUFFER, propFlags, gl.DYNAMIC_DRAW);
                }
              }
            }

            gl.bindVertexArray(null);

            // Update last states
            this._lastLinkAnchorId = anchorId;
            this._lastLinkViewEpoch = this._viewEpoch;
            this._lastLinkPosEpoch = this._posEpoch;
            this._lastLinkDragEpoch = this._dragEpoch;
            this._lastLinkProspectiveParentId = this._prospectiveParentId;
            this._lastLinkTriDataEpoch = this._triDataEpoch;
            this._linkBasis = { sx: m[0], sy: m[4], b: m[1], c: m[3], config: this._config, tx, ty, w: vpW, h: vpH };
          } // end if (selC && needsRebuild)

          // Draw link lines if selection exists (uses cached/fresh endpoints)
          if (selC || this._linkDepsCount > 0 || this._linkRdepsCount > 0) {
            // Common state for both batches
            gl.useProgram(this.linkLineProgram);
            const U = (this._uniforms && this._uniforms.linkLine) ? this._uniforms.linkLine : null;
            const uVP  = U ? U.u_viewport  : gl.getUniformLocation(this.linkLineProgram, 'u_viewport');
            const uTh  = U ? U.u_thickness : gl.getUniformLocation(this.linkLineProgram, 'u_thickness');
            const uCol = U ? U.u_color     : gl.getUniformLocation(this.linkLineProgram, 'u_color');
            if (uVP)  gl.uniform2f(uVP, vpW, vpH);
            gl.uniform2f(U?.u_pan ?? gl.getUniformLocation(this.linkLineProgram, 'u_pan'), tx - (this._linkBasis?.tx ?? tx), ty - (this._linkBasis?.ty ?? ty));
            // Fixed 2px thickness for link lines (selected or dragging)
            if (uTh)  gl.uniform1f(uTh, 2.0);
            // Set drag delta uniform (CSS px); endpoints move via GPU flags
            {
              const uDX = U ? U.u_dragCssX : gl.getUniformLocation(this.linkLineProgram, 'u_dragCssX');
              const dxCss = (this._dragActive ? ((this.matrix[0] || 0) * (this._dragOffsetX || 0)) : 0.0);
              if (uDX) gl.uniform1f(uDX, dxCss);
            }

            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.disable(gl.DEPTH_TEST);
            gl.depthMask(false);

            gl.bindVertexArray(this.linkLineVAO);

            // Draw property-colored deps (dependencies) — 2px thickness
            // Colors show which expression of the selected note references each dependency
            const isDragging = !!(this._dragActive && this._dragOverlay);
            const dragType = this._dragOverlay?.type || '';
            const isMove = dragType === 'move';
            const isResize = dragType === 'resize';

            // Themed dependency-highlight tokens (classic-orange equals the old literals)
            const lFq = this._depFrequencyRgba();
            const lSt = this._depStartTimeRgba();
            const lDu = this._depDurationRgba();
            const lineA = (c: number[], a: number) => [c[0], c[1], c[2], a];

            // Deps colors (brighter, thicker - these are what the selected note depends on)
            const DEPS_LINE_COLORS_NORMAL = {
              frequency: lineA(lFq, 0.6),
              startTime: lineA(lSt, 0.6),
              duration:  lineA(lDu, 0.6)
            };

            const DEPS_LINE_COLORS_DRAG = {
              frequency: lineA(lFq, 0.15),
              startTime: lineA(lSt, 0.6),
              duration:  lineA(lDu, 0.15)
            };

            const DEPS_LINE_COLORS_RESIZE = {
              frequency: lineA(lFq, 0.15),
              startTime: lineA(lSt, 0.15),
              duration:  lineA(lDu, 0.6)
            };

            const DEPS_LINE_COLORS = isDragging
              ? (isResize ? DEPS_LINE_COLORS_RESIZE : DEPS_LINE_COLORS_DRAG)
              : DEPS_LINE_COLORS_NORMAL;

            if (uTh) gl.uniform1f(uTh, 4.0);

            for (const prop of ['startTime', 'frequency', 'duration'] as const) {
              const count = this._linkDepsCountByProperty?.[prop] || 0;
              if (count > 0 && this._linkDepsBuffersByProperty?.[prop]) {
                const color = DEPS_LINE_COLORS[prop];
                if (uCol) gl.uniform4f(uCol, color[0], color[1], color[2], color[3]);

                gl.bindBuffer(gl.ARRAY_BUFFER, this._linkDepsBuffersByProperty[prop].endpoints);
                gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
                gl.vertexAttribDivisor(1, 1);

                gl.bindBuffer(gl.ARRAY_BUFFER, this._linkDepsBuffersByProperty[prop].flags);
                gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
                gl.vertexAttribDivisor(2, 1);

                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, count);
              }
            }

            // Draw property-colored rdeps (dependents) — 1px thickness
            // Colors follow the paradigm: which notes would MOVE if this property changes
            // Orange: frequency, Teal: startTime, Purple: duration

            // Rdeps colors (dimmer, thinner - these depend on the selected note)
            const RDEPS_LINE_COLORS_NORMAL = {
              frequency: lineA(lFq, 0.25),
              startTime: lineA(lSt, 0.25),
              duration:  lineA(lDu, 0.25)
            };

            const RDEPS_LINE_COLORS_DRAG = {
              frequency: lineA(lFq, 0.08),
              startTime: lineA(lSt, 0.3),
              duration:  lineA(lDu, 0.08)
            };

            const RDEPS_LINE_COLORS_RESIZE = {
              frequency: lineA(lFq, 0.08),
              startTime: lineA(lSt, 0.08),
              duration:  lineA(lDu, 0.3)
            };

            const RDEPS_LINE_COLORS = isDragging
              ? (isResize ? RDEPS_LINE_COLORS_RESIZE : RDEPS_LINE_COLORS_DRAG)
              : RDEPS_LINE_COLORS_NORMAL;

            if (uTh) gl.uniform1f(uTh, 2.0);

            for (const prop of ['startTime', 'frequency', 'duration'] as const) {
              const count = this._linkCountByProperty?.[prop] || 0;
              if (count > 0 && this._linkBuffersByProperty?.[prop]) {
                const color = RDEPS_LINE_COLORS[prop];
                if (uCol) gl.uniform4f(uCol, color[0], color[1], color[2], color[3]);

                gl.bindBuffer(gl.ARRAY_BUFFER, this._linkBuffersByProperty[prop].endpoints);
                gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
                gl.vertexAttribDivisor(1, 1);

                gl.bindBuffer(gl.ARRAY_BUFFER, this._linkBuffersByProperty[prop].flags);
                gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
                gl.vertexAttribDivisor(2, 1);

                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, count);
              }
            }

            gl.bindVertexArray(null);
            gl.depthMask(true);
            gl.enable(gl.DEPTH_TEST);
          }
        }
      } catch {}

      // Drag overlays: snap guides (vertical 1px lines) + ghost fill over preview rect
      try {
        const st = this._dragOverlay;
        let __isNoteValid = false;
        if (this.drawDragOverlays && st && st.noteId != null && this._noteIdToIndex) {
          const idx = this._noteIdToIndex.get(Number(st.noteId));
          __isNoteValid = (idx != null && idx >= 0 && idx < this.instanceCount);
          if (__isNoteValid && idx != null) {
            const base = idx * 4;
            const xw = positions[base + 0], yw = positions[base + 1];
            const ww = positions[base + 2], hh = positions[base + 3];

            // 1) Ghost fill (rounded rect interior), world-space via selectionFillProgram
            if (this.drawDragGhosts && this.selectionFillProgram) {
              gl.useProgram(this.selectionFillProgram);
              const Uf = (this._uniforms && this._uniforms.selectionFill) ? this._uniforms.selectionFill : null;
              const uMat = Uf ? Uf.u_matrix       : gl.getUniformLocation(this.selectionFillProgram, 'u_matrix');
              const uVP  = Uf ? Uf.u_viewport     : gl.getUniformLocation(this.selectionFillProgram, 'u_viewport');
              const uOff = Uf ? Uf.u_offset       : gl.getUniformLocation(this.selectionFillProgram, 'u_offset');
              const uZ   = Uf ? Uf.u_layerZ       : gl.getUniformLocation(this.selectionFillProgram, 'u_layerZ');
              const uSC  = Uf ? Uf.u_scale        : gl.getUniformLocation(this.selectionFillProgram, 'u_scale');
              const uCR  = Uf ? Uf.u_cornerRadius : gl.getUniformLocation(this.selectionFillProgram, 'u_cornerRadius');
              const uIN  = Uf ? Uf.u_inset        : gl.getUniformLocation(this.selectionFillProgram, 'u_inset');
              const uCol = Uf ? Uf.u_color        : gl.getUniformLocation(this.selectionFillProgram, 'u_color');

              if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
              if (uVP)  gl.uniform2f(uVP, vpW, vpH);
              if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
              if (uZ)   gl.uniform1f(uZ, -0.00003);
              if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
              if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
              if (uIN)  gl.uniform1f(uIN, 1.0 * (this.xScalePxPerWU || 1.0));
              // Tint ghost with note body color and low alpha
              try {
                const c0 = this.colors ? this.colors[base + 0] : 1.0;
                const c1 = this.colors ? this.colors[base + 1] : 1.0;
                const c2 = this.colors ? this.colors[base + 2] : 1.0;
                if (uCol) gl.uniform4f(uCol, c0, c1, c2, 0.18);
              } catch {
                if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.10);
              }

              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.disable(gl.DEPTH_TEST);
              gl.depthMask(false);

              gl.bindVertexArray(this.rectVAO);
              if (!this._singlePosSizeBuffer) {
                this._singlePosSizeBuffer = gl.createBuffer();
              }
              gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([xw, yw, ww, hh]), gl.DYNAMIC_DRAW);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              gl.vertexAttribDivisor(1, 1);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

              // Restore instanced buffer for attr 1
              gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              gl.vertexAttribDivisor(1, 1);
              gl.bindVertexArray(null);

              gl.depthMask(true);
              gl.enable(gl.DEPTH_TEST);
            }

            // Dependent ghosts (translucent) — show where dependents will move/shift
            try {
              const stDO = this._dragOverlay || null;
              if (this.drawDragGhosts && stDO && (stDO.type === 'move' || stDO.type === 'resize') && this._ensureGhostIndices()?.length && this.selectionFillProgram) {
                const dxWU   = ((stDO.dxSec || 0) * this._cfgSX()) * (this.currentXScaleFactor || 1.0);
                const ddurWU = ((stDO.ddurSec || 0) * this._cfgSX()) * (this.currentXScaleFactor || 1.0);

                gl.useProgram(this.selectionFillProgram);
                const Uf2 = (this._uniforms && this._uniforms.selectionFill) ? this._uniforms.selectionFill : null;
                const uMat2 = Uf2 ? Uf2.u_matrix       : gl.getUniformLocation(this.selectionFillProgram, 'u_matrix');
                const uVP2  = Uf2 ? Uf2.u_viewport     : gl.getUniformLocation(this.selectionFillProgram, 'u_viewport');
                const uOff2 = Uf2 ? Uf2.u_offset       : gl.getUniformLocation(this.selectionFillProgram, 'u_offset');
                const uZ2   = Uf2 ? Uf2.u_layerZ       : gl.getUniformLocation(this.selectionFillProgram, 'u_layerZ');
                const uSC2  = Uf2 ? Uf2.u_scale        : gl.getUniformLocation(this.selectionFillProgram, 'u_scale');
                const uCR2  = Uf2 ? Uf2.u_cornerRadius : gl.getUniformLocation(this.selectionFillProgram, 'u_cornerRadius');
                const uIN2  = Uf2 ? Uf2.u_inset        : gl.getUniformLocation(this.selectionFillProgram, 'u_inset');
                const uCol2 = Uf2 ? Uf2.u_color        : gl.getUniformLocation(this.selectionFillProgram, 'u_color');

                if (uMat2) gl.uniformMatrix3fv(uMat2, false, this.matrix);
                if (uVP2)  gl.uniform2f(uVP2, vpW, vpH);
                if (uOff2) gl.uniform2f(uOff2, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
                if (uZ2)   gl.uniform1f(uZ2, -0.00003);
                if (uSC2)  gl.uniform2f(uSC2, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
                if (uCR2)  gl.uniform1f(uCR2, 6.0 * (this.xScalePxPerWU || 1.0));
                if (uIN2)  gl.uniform1f(uIN2, 1.0 * (this.xScalePxPerWU || 1.0));

                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.DEPTH_TEST);
                gl.depthMask(false);

                gl.bindVertexArray(this.rectVAO);
                if (!this._singlePosSizeBuffer) { this._singlePosSizeBuffer = gl.createBuffer(); }
                gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);

                for (let ii = 0; this._relRdepsIdx && ii < this._relRdepsIdx.length; ii++) {
                  const idxDep = this._relRdepsIdx[ii];
                  if (idxDep == null || idxDep < 0 || idxDep >= this.instanceCount) continue;
                  const oDep = idxDep * 4;
                  const xwDep = positions[oDep + 0];
                  const ywDep = positions[oDep + 1];
                  const wwDep = positions[oDep + 2];
                  const hhDep = positions[oDep + 3];
                  // Move dependents with dx on move; shift with ddur on resize preview
                  let shiftX = 0.0;
                  if (stDO.type === 'move') shiftX = dxWU;
                  else if (stDO.type === 'resize') shiftX = ddurWU;

                  // Per-dependent tinted ghost color at low alpha
                  try {
                    const baseDep = idxDep * 4;
                    const r = this.colors ? this.colors[baseDep + 0] : 1.0;
                    const g = this.colors ? this.colors[baseDep + 1] : 1.0;
                    const b = this.colors ? this.colors[baseDep + 2] : 1.0;
                    if (uCol2) gl.uniform4f(uCol2, r, g, b, 0.14);
                  } catch {
                    if (uCol2) gl.uniform4f(uCol2, 1.0, 1.0, 1.0, 0.14);
                  }

                  const arrDep = new Float32Array([xwDep + shiftX, ywDep, wwDep, hhDep]);
                  gl.bufferData(gl.ARRAY_BUFFER, arrDep, gl.DYNAMIC_DRAW);
                  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
                  gl.vertexAttribDivisor(1, 1);
                  gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
                }

                // Restore instanced buffer for attr 1
                gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
                gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
                gl.vertexAttribDivisor(1, 1);
                gl.bindVertexArray(null);

                gl.depthMask(true);
                gl.enable(gl.DEPTH_TEST);
              }
            } catch {}

            // 2) Snap guides (vertical 2px at start; for resize also at end) — selection-colored
            if (this.solidCssProgram && this.octaveLineVAO && this.octaveLinePosSizeBuffer) {
              const drawSnapAtWorldX = (xWorld: number, rgba: number[]) => {
                if (!this.solidCssProgram) return;
                // world x -> page CSS -> canvas-local
                const sx = this.matrix[0] * xWorld + this.matrix[6];
                const localX = (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx;
                // For a crisp 2px vertical line, center a 2px-wide quad on the pixel grid
                const widthPx = 2.0;
                const left = Math.round(localX) - 1.0;

                gl.useProgram(this.solidCssProgram);
                const Us = (this._uniforms && this._uniforms.solidCss) ? this._uniforms.solidCss : null;
                const uVP  = Us ? Us.u_viewport : gl.getUniformLocation(this.solidCssProgram, 'u_viewport');
                const uCol = Us ? Us.u_color    : gl.getUniformLocation(this.solidCssProgram, 'u_color');
                const uZ   = Us ? Us.u_z        : gl.getUniformLocation(this.solidCssProgram, 'u_z');
                if (uVP)  gl.uniform2f(uVP, vpW, vpH);
                if (uCol) gl.uniform4f(uCol, rgba[0], rgba[1], rgba[2], rgba[3]);
                if (uZ)   gl.uniform1f(uZ, -0.00003);

                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.DEPTH_TEST);
                gl.depthMask(false);

                gl.bindVertexArray(this.octaveLineVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([left, 0.0, widthPx, vpH]), gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
                gl.bindVertexArray(null);

                gl.depthMask(true);
                gl.enable(gl.DEPTH_TEST);
              };

              // Origin guides (teal, semi-transparent) to show where drag/resize started
              if (st.origStartSec != null) {
                const scaleX = (this.currentXScaleFactor || 1.0);
                const teal = [0.0, 0.0, 0.545098, 0.6];
                if (st.type === 'move') {
                  const oStart = Number(st.origStartSec || 0) * this._cfgSX() * scaleX;
                  drawSnapAtWorldX(oStart, teal);
                } else if (st.type === 'resize') {
                  // Start is an origin during right-edge resize; draw it in teal
                  const oStart = Number(st.origStartSec || 0) * this._cfgSX() * scaleX;
                  drawSnapAtWorldX(oStart, teal);
                  // Original end marks original size
                  const oEnd = (Number(st.origStartSec || 0) + Number(st.origDurationSec || 0)) * this._cfgSX() * scaleX;
                  drawSnapAtWorldX(oEnd, teal);
                }
              }

              // Current guides (white, slightly transparent to be less prominent)
              if (st.type === 'resize') {
                // Only draw the moving end in white; start is shown as teal origin
                drawSnapAtWorldX(xw + ww, [1.0, 1.0, 1.0, 0.6]);
              } else {
                drawSnapAtWorldX(xw, [1.0, 1.0, 1.0, 0.6]);
              }
            }
          }
        }
        // Fallback: measure triangle drag (no note instance). Draw origin and current bars.
        if (!__isNoteValid && st) {
          if (this.solidCssProgram && this.octaveLineVAO && this.octaveLinePosSizeBuffer) {
            const drawSnapAtWorldX = (xWorld: number, rgba: number[]) => {
                if (!this.solidCssProgram) return;
              const sx = this.matrix[0] * xWorld + this.matrix[6];
              const localX = (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx;
              const widthPx = 2.0;
              const left = Math.round(localX) - 1.0;

              gl.useProgram(this.solidCssProgram);
              const Us = (this._uniforms && this._uniforms.solidCss) ? this._uniforms.solidCss : null;
              const uVP  = Us ? Us.u_viewport : gl.getUniformLocation(this.solidCssProgram, 'u_viewport');
              const uCol = Us ? Us.u_color    : gl.getUniformLocation(this.solidCssProgram, 'u_color');
              const uZ   = Us ? Us.u_z        : gl.getUniformLocation(this.solidCssProgram, 'u_z');
              if (uVP)  gl.uniform2f(uVP, vpW, vpH);
              if (uCol) gl.uniform4f(uCol, rgba[0], rgba[1], rgba[2], rgba[3]);
              if (uZ)   gl.uniform1f(uZ, -0.00003);

              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.disable(gl.DEPTH_TEST);
              gl.depthMask(false);

              gl.bindVertexArray(this.octaveLineVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([left, 0.0, widthPx, vpH]), gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              gl.bindVertexArray(null);

              gl.depthMask(true);
              gl.enable(gl.DEPTH_TEST);
            };

            const scaleX = (this.currentXScaleFactor || 1.0);
            // Origin bar at original measure position (teal)
            if (st.origStartSec != null) {
              const oStart = Number(st.origStartSec || 0) * this._cfgSX() * scaleX;
              drawSnapAtWorldX(oStart, [0.0, 0.0, 0.545098, 0.6]);
            }
            // Current bar at preview position (white, semi-transparent)
            const curT = (Number(st.origStartSec || 0) + Number(st.dxSec || 0)) * this._cfgSX() * scaleX;
            drawSnapAtWorldX(curT, [1.0, 1.0, 1.0, 0.6]);
          }
        }
      } catch {}
    };

    // Hook into init lifecycle to create link-line pass once GL is available
    const _prevInit = proto.init;
    proto.init = function (containerEl) {
      const ok = _prevInit.call(this, containerEl);
      try { this._initLinkLinesPass(); } catch {}
      return ok;
    };

    // Hook into render lifecycle: run our pass after the existing overlay stack
    const _prevRender = proto._render;
    proto._render = function () {
      // Nothing has changed since the last frame, so keep the frame already on screen.
      // The innermost _render() has always early-returned on this flag, but the passes
      // layered on top of it (note overlays, measure bars, dependency lines) were called
      // unconditionally by the wrappers — so an idle frame still paid the full per-note
      // cost of every one of them. Measured before this gate: 46 ms/frame at 5k notes and
      // 1034 ms/frame at 100k, with the canvas showing an unchanged picture the whole time.
      // Every mutation that can affect the image (sync, hover, selection, playhead, camera,
      // drag, theme, config) sets needsRedraw, and no render pass sets it, so this cannot
      // drop a frame that matters or spin.
      if (!this.needsRedraw) return;
      _prevRender.call(this);
      try { this._renderDependencyLinesAndDragOverlay(); } catch {}
    };
  } catch {}
})();

/* Marquee (rubber-band) rectangle — screen-space, drawn last so it sits above every pass. */
(() => {
  try {
    if (typeof RendererAdapter === 'undefined') return;
    const proto = RendererAdapter.prototype;

    proto._initMarqueePass = function () {
      const gl = this.gl;
      if (!gl || this.marqueeProgram) return;

      const vs = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;      // (0..1) quad
        uniform vec4 u_rectCss;                 // (x, y, w, h) canvas-local CSS px
        uniform vec2 u_viewport;                // CSS px
        out vec2 v_local;                       // CSS px from the rect's top-left
        void main() {
          vec2 local = u_rectCss.xy + a_unit * u_rectCss.zw;
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
          v_local = a_unit * u_rectCss.zw;
        }
      `;
      const fs = `#version 300 es
        precision highp float;
        in vec2 v_local;
        uniform vec2 u_size;        // CSS px
        uniform float u_borderPx;
        uniform vec4 u_fill;
        uniform vec4 u_border;
        out vec4 outColor;
        void main() {
          float dx = min(v_local.x, u_size.x - v_local.x);
          float dy = min(v_local.y, u_size.y - v_local.y);
          float d = min(dx, dy);
          outColor = (d <= u_borderPx) ? u_border : u_fill;
          if (outColor.a <= 0.0) discard;
        }
      `;

      this.marqueeProgram = this._createProgram(vs, fs);
      if (!this.marqueeProgram) return;

      try {
        this._uniforms = this._uniforms || {};
        this._uniforms.marquee = {
          u_rectCss:  gl.getUniformLocation(this.marqueeProgram, 'u_rectCss'),
          u_viewport: gl.getUniformLocation(this.marqueeProgram, 'u_viewport'),
          u_size:     gl.getUniformLocation(this.marqueeProgram, 'u_size'),
          u_borderPx: gl.getUniformLocation(this.marqueeProgram, 'u_borderPx'),
          u_fill:     gl.getUniformLocation(this.marqueeProgram, 'u_fill'),
          u_border:   gl.getUniformLocation(this.marqueeProgram, 'u_border')
        };
      } catch {}

      this.marqueeVAO = gl.createVertexArray();
      gl.bindVertexArray(this.marqueeVAO);
      this._marqueeUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._marqueeUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };

    proto._renderMarquee = function () {
      const r = this._marqueeRect;
      if (!r) return;
      const gl = this.gl;
      const canvas = this.canvas;
      if (!gl || !canvas) return;

      if (!this.marqueeProgram) {
        this._initMarqueePass();
        if (!this.marqueeProgram) return;
      }

      const rectCss = this._cachedCanvasRect || canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);
      const offX = this.canvasOffset?.x || 0;
      const offY = this.canvasOffset?.y || 0;

      const x = Math.min(r.x0, r.x1) - offX;
      const y = Math.min(r.y0, r.y1) - offY;
      const w = Math.max(1, Math.abs(r.x1 - r.x0));
      const h = Math.max(1, Math.abs(r.y1 - r.y0));

      // Marquee tracks the ACCENT token (pre-theme literal #ffa800), not selectionRing:
      // classic-orange's selectionRing token is white (the note ring literal), while the
      // marquee has always drawn orange.
      const accent = this._accentRgba();
      const border = [accent[0], accent[1], accent[2], 0.95];
      const fill   = [accent[0], accent[1], accent[2], 0.12];

      gl.useProgram(this.marqueeProgram);
      const U = (this._uniforms && this._uniforms.marquee) ? this._uniforms.marquee : null;
      const uRect = U ? U.u_rectCss  : gl.getUniformLocation(this.marqueeProgram, 'u_rectCss');
      const uVP   = U ? U.u_viewport : gl.getUniformLocation(this.marqueeProgram, 'u_viewport');
      const uSize = U ? U.u_size     : gl.getUniformLocation(this.marqueeProgram, 'u_size');
      const uBW   = U ? U.u_borderPx : gl.getUniformLocation(this.marqueeProgram, 'u_borderPx');
      const uFill = U ? U.u_fill     : gl.getUniformLocation(this.marqueeProgram, 'u_fill');
      const uBrd  = U ? U.u_border   : gl.getUniformLocation(this.marqueeProgram, 'u_border');

      if (uRect) gl.uniform4f(uRect, x, y, w, h);
      if (uVP)   gl.uniform2f(uVP, vpW, vpH);
      if (uSize) gl.uniform2f(uSize, w, h);
      if (uBW)   gl.uniform1f(uBW, 1.0);
      if (uFill) gl.uniform4f(uFill, fill[0], fill[1], fill[2], fill[3]);
      if (uBrd)  gl.uniform4f(uBrd, border[0], border[1], border[2], border[3]);

      // Earlier passes leave premultiplied blending, scissor and depth in arbitrary states;
      // the marquee is the topmost overlay, so it sets all three explicitly.
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      gl.bindVertexArray(this.marqueeVAO);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      gl.bindVertexArray(null);

      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    };

    const _prevInitM = proto.init;
    proto.init = function (containerEl) {
      const ok = _prevInitM.call(this, containerEl);
      try { this._initMarqueePass(); } catch {}
      return ok;
    };

    const _prevRenderM = proto._render;
    proto._render = function () {
      // Mirror the gate below: when nothing changed the wrapped chain draws nothing and the
      // previous frame is still on screen, so re-blending the marquee would darken it.
      const wasDirty = !!this.needsRedraw;
      _prevRenderM.call(this);
      if (!wasDirty) return;
      try { this._renderMarquee(); } catch {}
    };
  } catch {}
})();

// Reference lines: notes that only relate (a frequency, no duration). A tonic, a key
// or a chord root is a dashed line across the whole workspace at its pitch; with a
// start it is a key change, the same line from that start on. They never sound. Drawn
// with the octave guides' per-line dashed program (one draw per line; it re-uploads
// its quad every draw, so sharing its buffer leaves nothing stale), longer dashes.
(() => {
  try {
    if (typeof RendererAdapter === 'undefined') return;
    const proto = RendererAdapter.prototype;

    proto._renderReferenceLines = function () {
      const gl = this.gl;
      const lines = this._refLines;
      this._refLineCss = [];
      if (!gl || !this.canvas || !lines || !lines.length) return;
      if (!this.octaveLineProgram || !this.octaveLineVAO || !this.octaveLinePosSizeBuffer) return;

      const rect = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rect.width), vpH = Math.max(1, rect.height);
      const m = this.matrix;
      const ox = this.canvasOffset?.x ?? 0, oy = this.canvasOffset?.y ?? 0;
      const sx = this._cfgSX() * (this.currentXScaleFactor || 1);
      const ac = this._accentRgba();
      const sel = this._lastSelectedNoteId != null ? Number(this._lastSelectedNoteId) : null;

      const P = this.octaveLineProgram;
      const uVP = gl.getUniformLocation(P, 'u_viewport');
      const uDash = gl.getUniformLocation(P, 'u_dashLen');
      const uGap = gl.getUniformLocation(P, 'u_gapLen');
      const uCol = gl.getUniformLocation(P, 'u_color');
      const uHole = gl.getUniformLocation(P, 'u_holeRect');
      const T = this.textProgram;
      const uVPt = T ? gl.getUniformLocation(T, 'u_viewport') : null;
      const uTint = T ? gl.getUniformLocation(T, 'u_tint') : null;
      const uTex = T ? gl.getUniformLocation(T, 'u_tex') : null;
      gl.disable(gl.SCISSOR_TEST);

      for (const L of lines) {
        const yw = this._noteCenterY(L.freq);
        const xw = L.startSec != null ? L.startSec * sx : 0;
        const lyRaw = m[1] * xw + m[4] * yw + m[7] - oy;
        const y = Math.floor(lyRaw) + 0.5;
        if (y < -4 || y > vpH + 4) continue;
        const x0 = L.startSec != null ? Math.max(-1, m[0] * xw + m[3] * yw + m[6] - ox) : -1;
        if (x0 > vpW) continue;
        const selected = sel === L.id;
        const entry = this._createTextTexture(`[${L.id}]`);
        // A key change's label sits just before its start, where it reads as the
        // marker for what follows (after it, the first note in the new key covers it).
        let lx = 8;
        if (L.startSec != null) {
          const w = entry ? entry.wCss : 0;
          lx = (x0 - w - 6 >= 8) ? (x0 - w - 6) : Math.max(8, x0 + 6);
        }

        gl.useProgram(P);
        if (uVP) gl.uniform2f(uVP, vpW, vpH);
        if (uDash) gl.uniform1f(uDash, 8.0);   // longer than the octave guides' 3/3
        if (uGap) gl.uniform1f(uGap, 4.0);
        if (uCol) gl.uniform4f(uCol, ac[0], ac[1], ac[2], selected ? 1.0 : 0.7);
        if (uHole) {
          if (entry) gl.uniform4f(uHole, lx - 3, y - entry.hCss * 0.5 - 1, entry.wCss + 6, entry.hCss + 2);
          else gl.uniform4f(uHole, 0, 0, 0, 0);
        }
        gl.bindVertexArray(this.octaveLineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, selected ? y - 0.5 : y, vpW + 2 - x0, selected ? 2 : 1]), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

        if (entry && entry.tex && T && this.textVAO && this.textPosSizeBuffer) {
          gl.useProgram(T);
          if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
          if (uTex) gl.uniform1i(uTex, 0);
          if (uTint) gl.uniform4f(uTint, 1, 1, 1, selected ? 1.0 : 0.9);
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.tex);
          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([lx, y - entry.hCss * 0.5, entry.wCss, entry.hCss]), gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
        this._refLineCss.push({ id: L.id, y, x0 });
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };

    // Within 4 CSS px of a drawn line (and, for a key change, at or after its start).
    proto.pickReferenceLinesAt = function (clientX, clientY, firstOnly = false) {
      const css = this._refLineCss;
      if (!css || !css.length) return [];
      const px = clientX - (this.canvasOffset?.x ?? 0);
      const py = clientY - (this.canvasOffset?.y ?? 0);
      const hits: SceneHit[] = [];
      for (const r of css) {
        if (px >= r.x0 - 2 && Math.abs(py - r.y) <= 4) {
          hits.push({ type: 'reference', id: r.id });
          if (firstOnly) break;
        }
      }
      return hits;
    };
  } catch {}
})();
