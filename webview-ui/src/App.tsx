import { useCallback, useEffect, useRef, useState } from 'react';

import { toMajorMinor } from './changelogData.js';
import { AgentPanel } from './components/AgentPanel.js';
import { AgentRosterPanel } from './components/AgentRosterPanel.js';
import { ApprovalsBox } from './components/ApprovalsBox.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { CommandBar } from './components/CommandBar.js';
import { DebugView } from './components/DebugView.js';
import { EditActionBar } from './components/EditActionBar.js';
import { FacilityWatchFeed } from './components/FacilityWatchFeed.js';
import { MigrationNotice } from './components/MigrationNotice.js';
import { MissionBoard } from './components/MissionBoard.js';
import { SettingsModal } from './components/SettingsModal.js';
import { SpawnErrorToast } from './components/SpawnErrorToast.js';
import { SwarmCommandBar } from './components/SwarmCommandBar.js';
import { Tooltip } from './components/Tooltip.js';
import { Modal } from './components/ui/Modal.js';
import { VersionIndicator } from './components/VersionIndicator.js';
import { ZoomControls } from './components/ZoomControls.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { EditTool } from './office/types.js';
import { isBrowserRuntime } from './runtime.js';
import { transport } from './transport/index.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    // browserMock is for Vite dev mode only (UI prototyping without a server).
    // In standalone server mode, the server sends all state over WebSocket.
    if (isBrowserRuntime && import.meta.env.DEV) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
    providers,
    activityByAgent,
    spawnError,
    clearSpawnError,
    agentProviders,
    sandboxTiers,
    facilityProgress,
    facilityFeed,
    providerKeysSet,
    permissionRequestByAgent,
    pendingApprovals,
    taskTree,
    autonomyLevel,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  const [facilityWatchMode, setFacilityWatchMode] = useState(true);
  useEffect(() => {
    getOfficeState().facilityWatchMode = facilityWatchMode;
  }, [facilityWatchMode]);

  const handleToggleFacilityWatch = useCallback(() => {
    setFacilityWatchMode((prev) => {
      const next = !prev;
      getOfficeState().facilityWatchMode = next;
      return next;
    });
  }, []);

  // Pan camera during room expansion; homemaking/operating follow via facilityBuild + tool events
  const builtRooms = facilityProgress?.builtRooms;
  const facilityPhase = facilityProgress?.phase;
  useEffect(() => {
    if (facilityPhase !== 'building' || builtRooms === undefined) return;
    const os = getOfficeState();
    if (!os.facilityWatchMode) return;
    const followLabel = builtRooms > 0 ? `Worker #${builtRooms}` : 'ORCHESTRATOR';
    for (const ch of os.characters.values()) {
      if (ch.folderName === followLabel) {
        os.setCameraFocus(ch.id);
        break;
      }
    }
  }, [builtRooms, facilityPhase]);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [isMissionsOpen, setIsMissionsOpen] = useState(false);
  const [isHooksInfoOpen, setIsHooksInfoOpen] = useState(false);
  const [hooksTooltipDismissed, setHooksTooltipDismissed] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(false);

  const currentMajorMinor = toMajorMinor(extensionVersion);

  const handleWhatsNewDismiss = useCallback(() => {
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  // Sync alwaysShowOverlay from persisted settings
  useEffect(() => {
    setAlwaysShowOverlay(alwaysShowLabels);
  }, [alwaysShowLabels]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);
  const handleToggleAlwaysShowOverlay = useCallback(() => {
    setAlwaysShowOverlay((prev) => {
      const newVal = !prev;
      transport.send({ type: 'setAlwaysShowLabels', enabled: newVal });
      return newVal;
    });
  }, []);

  const handleSelectAgent = useCallback((id: number) => {
    transport.send({ type: 'focusAgent', id });
  }, []);

  const getAgentName = useCallback(
    (id: number): string => {
      const ch = getOfficeState().characters.get(id);
      return ch?.folderName ?? `Worker #${id}`;
    },
    [],
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const handleCloseAgent = useCallback((id: number) => {
    transport.send({ type: 'closeAgent', id });
  }, []);

  const handleClick = useCallback((agentId: number) => {
    // If clicked agent is a sub-agent, focus the parent's terminal instead
    const os = getOfficeState();
    const meta = os.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    transport.send({ type: 'focusAgent', id: focusId });
  }, []);

  // Agent panel: opens for the selected agent. Driven by both the message-level
  // selection (spawn / agentCreated) and canvas clicks (onAgentSelected).
  const [panelAgentId, setPanelAgentId] = useState<number | null>(null);
  useEffect(() => {
    setPanelAgentId(selectedAgent);
  }, [selectedAgent]);

  const handleAgentSelected = useCallback(
    (id: number | null) => {
      // Sub-agents focus their parent terminal but should not open a panel.
      if (id !== null && getOfficeState().subagentMeta.has(id)) return;
      setPanelAgentId(id);
      if (id !== null && facilityProgress) {
        const os = getOfficeState();
        os.facilityWatchMode = true;
        os.setCameraFocus(id);
        setFacilityWatchMode(true);
      }
    },
    [facilityProgress],
  );

  const handleFeedSelectAgent = useCallback((id: number) => {
    const os = getOfficeState();
    os.facilityWatchMode = true;
    os.setCameraFocus(id);
    setFacilityWatchMode(true);
    transport.send({ type: 'focusAgent', id });
    setPanelAgentId(id);
  }, []);

  const handleProviderKeySave = useCallback((name: string, value: string) => {
    transport.send({ type: 'setProviderKey', name, value });
  }, []);

  const handleSetAutonomyLevel = useCallback((level: 'auto' | 'safe' | 'manual') => {
    transport.send({ type: 'setAutonomyLevel', level });
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanelAgentId(null);
    const os = getOfficeState();
    os.selectedAgentId = null;
    os.cameraFollowId = null;
  }, []);

  const officeState = getOfficeState();

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  const panelCharacter =
    panelAgentId !== null ? officeState.characters.get(panelAgentId) : undefined;
  const panelDisplayName =
    panelCharacter?.folderName ?? (panelAgentId !== null ? `Worker #${panelAgentId}` : '');
  const panelIsOrchestrator = panelCharacter?.folderName === 'ORCHESTRATOR';

  // Resolve the panel's provider display name (string | null).
  const panelProviderName =
    panelAgentId !== null
      ? (() => {
          const providerId = agentProviders[panelAgentId];
          if (!providerId) return null;
          const p = providers.find((pr) => pr.id === providerId);
          return p ? p.displayName : providerId;
        })()
      : null;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return <div className="w-full h-full flex items-center justify-center ">Loading...</div>;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        onAgentSelected={handleAgentSelected}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
      />

      {!isDebugMode ? (
        <>
          {facilityProgress && (
            <CommandBar
              facilityProgress={facilityProgress}
              agentCount={agents.length}
              providers={providers}
            />
          )}
          {facilityProgress && (
            <FacilityWatchFeed
              items={facilityFeed}
              missionBoard={facilityProgress.missionBoard}
              sharedGoals={facilityProgress.sharedGoals}
              onSelectAgent={handleFeedSelectAgent}
            />
          )}
          {facilityProgress && (
            <SwarmCommandBar
              watchMode={facilityWatchMode}
              onToggleWatch={handleToggleFacilityWatch}
            />
          )}
          <ZoomControls
            zoom={editor.zoom}
            onZoomChange={editor.handleZoomChange}
            topOffset={facilityProgress ? 56 : 8}
          />

          {/* Vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'var(--vignette)' }}
          />

          {editor.isEditMode && editor.isDirty && (
            <EditActionBar editor={editor} editorState={editorState} />
          )}

          {showRotateHint && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-20 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
              style={{ top: editor.isDirty ? 64 : 8 }}
            >
              Rotate (R)
            </div>
          )}

          {editor.isEditMode &&
            (() => {
              const selUid = editorState.selectedFurnitureUid;
              const selColor = selUid
                ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                : null;
              return (
                <EditorToolbar
                  activeTool={editorState.activeTool}
                  selectedTileType={editorState.selectedTileType}
                  selectedFurnitureType={editorState.selectedFurnitureType}
                  selectedFurnitureUid={selUid}
                  selectedFurnitureColor={selColor}
                  floorColor={editorState.floorColor}
                  wallColor={editorState.wallColor}
                  selectedWallSet={editorState.selectedWallSet}
                  onToolChange={editor.handleToolChange}
                  onTileTypeChange={editor.handleTileTypeChange}
                  onFloorColorChange={editor.handleFloorColorChange}
                  onWallColorChange={editor.handleWallColorChange}
                  onWallSetChange={editor.handleWallSetChange}
                  onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                  onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                  loadedAssets={loadedAssets}
                />
              );
            })()}

          <ToolOverlay
            officeState={officeState}
            agents={agents}
            agentTools={agentTools}
            subagentCharacters={subagentCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            onCloseAgent={handleCloseAgent}
            alwaysShowOverlay={alwaysShowOverlay || facilityProgress !== null}
            agentProviders={agentProviders}
            providers={providers}
          />

          {panelAgentId !== null && (
            <AgentPanel
              agentId={panelAgentId}
              displayName={panelDisplayName}
              isOrchestrator={panelIsOrchestrator}
              providerName={panelProviderName}
              sandboxTier={sandboxTiers[panelAgentId]}
              status={agentStatuses[panelAgentId] ?? 'idle'}
              tools={agentTools[panelAgentId] ?? []}
              activity={activityByAgent.get(panelAgentId) ?? []}
              permissionRequestId={permissionRequestByAgent[panelAgentId]}
              onClose={handleClosePanel}
            />
          )}

          {spawnError && <SpawnErrorToast message={spawnError} onDismiss={clearSpawnError} />}
        </>
      ) : (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          onSelectAgent={handleSelectAgent}
        />
      )}

      {/* Hooks first-run tooltip */}
      {!hooksInfoShown && !hooksTooltipDismissed && (
        <Tooltip
          title="Instant Detection Active"
          position="top-right"
          onDismiss={() => {
            setHooksTooltipDismissed(true);
            transport.send({ type: 'setHooksInfoShown' });
          }}
        >
          <span className="text-sm text-text leading-none">
            Your agents now respond in real-time.{' '}
            <span
              className="text-accent cursor-pointer underline"
              onClick={() => {
                setIsHooksInfoOpen(true);
                setHooksTooltipDismissed(true);
                transport.send({ type: 'setHooksInfoShown' });
              }}
            >
              View more
            </span>
          </span>
        </Tooltip>
      )}

      {/* Hooks info modal */}
      <Modal
        isOpen={isHooksInfoOpen}
        onClose={() => setIsHooksInfoOpen(false)}
        title="Agent Event Hooks are ON"
        zIndex={52}
      >
        <div className="text-base text-text px-10" style={{ lineHeight: 1.4 }}>
          <p className="mb-8">Your Pixel Agents office now reacts in real-time:</p>
          <ul className="mb-8 pl-18 list-disc m-0">
            <li className="text-sm mb-2">Permission prompts appear instantly</li>
            <li className="text-sm mb-2">Turn completions detected the moment they happen</li>
            <li className="text-sm mb-2">Sound notifications play immediately</li>
          </ul>
          <p className="mb-12 text-text-muted">
            This works through provider event hooks, small listeners that notify Pixel Agents
            whenever something happens in external agent sessions.
          </p>
          <div className="text-center">
            <button
              onClick={() => setIsHooksInfoOpen(false)}
              className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
            >
              Got it
            </button>
          </div>
          <p className="mt-8 text-xs text-text-muted text-center">
            To disable, go to Settings {'>'} Agent Event Hooks
          </p>
        </div>
      </Modal>

      {isMissionsOpen && (
        <MissionBoard
          items={taskTree}
          onClose={() => setIsMissionsOpen(false)}
        />
      )}

      <ApprovalsBox
        pendingApprovals={pendingApprovals}
        agentTools={agentTools}
        getAgentName={getAgentName}
        onReply={(requestId, approved) =>
          transport.send({ type: 'permissionReply', requestId, approved })
        }
      />

      {isRosterOpen && (
        <AgentRosterPanel
          agents={agents}
          agentProviders={agentProviders}
          sandboxTiers={sandboxTiers}
          agentStatuses={agentStatuses}
          agentTools={agentTools}
          providers={providers}
          selectedAgentId={panelAgentId}
          officeState={officeState}
          onSelectAgent={(id) => {
            handleAgentSelected(id);
            transport.send({ type: 'focusAgent', id });
          }}
        />
      )}

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onToggleEditMode={editor.handleToggleEditMode}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => setIsSettingsOpen((v) => !v)}
        isRosterOpen={isRosterOpen}
        onToggleRoster={() => setIsRosterOpen((v) => !v)}
        isMissionsOpen={isMissionsOpen}
        onToggleMissions={() => setIsMissionsOpen((v) => !v)}
        agentCount={agents.length}
        providers={providers}
      />

      <VersionIndicator
        currentVersion={extensionVersion}
        lastSeenVersion={lastSeenVersion}
        onDismiss={handleWhatsNewDismiss}
        onOpenChangelog={handleOpenChangelog}
      />

      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
        currentVersion={extensionVersion}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        alwaysShowOverlay={alwaysShowOverlay}
        onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
        externalAssetDirectories={externalAssetDirectories}
        watchAllSessions={watchAllSessions}
        onToggleWatchAllSessions={() => {
          const newVal = !watchAllSessions;
          setWatchAllSessions(newVal);
          transport.send({ type: 'setWatchAllSessions', enabled: newVal });
        }}
        hooksEnabled={hooksEnabled}
        onToggleHooksEnabled={() => {
          const newVal = !hooksEnabled;
          setHooksEnabled(newVal);
          transport.send({ type: 'setHooksEnabled', enabled: newVal });
        }}
        providerKeysSet={providerKeysSet}
        onProviderKeySave={handleProviderKeySave}
        autonomyLevel={autonomyLevel}
        onSetAutonomyLevel={handleSetAutonomyLevel}
      />

      {showMigrationNotice && (
        <MigrationNotice onDismiss={() => setMigrationNoticeDismissed(true)} />
      )}
    </div>
  );
}

export default App;
