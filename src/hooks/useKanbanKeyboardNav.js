import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for keyboard navigation in Kanban board
 * Provides WCAG 2.1 Level A compliant keyboard navigation
 *
 * @param {Array} deals - Array of deals
 * @param {Array} stages - Array of pipeline stages
 * @param {Function} onUpdateDeal - Callback to update deal stage
 * @param {Function} onSelectDeal - Callback when deal is selected
 * @returns {Object} Keyboard navigation state and handlers
 */
export function useKanbanKeyboardNav(deals, stages, onUpdateDeal, onSelectDeal) {
  const [focusedDealId, setFocusedDealId] = useState(null);
  const [isDraggingWithKeyboard, setIsDraggingWithKeyboard] = useState(false);
  const [draggedDealId, setDraggedDealId] = useState(null);
  const [targetStageId, setTargetStageId] = useState(null);

  // Group deals by stage
  const dealsByStage = useCallback(() => {
    const grouped = {};
    stages.forEach(stage => {
      grouped[stage.id] = deals.filter(d => d.stage === stage.id);
    });
    return grouped;
  }, [deals, stages]);

  // Get current deal and stage info
  const getFocusedDealInfo = useCallback(() => {
    if (!focusedDealId) return null;
    const deal = deals.find(d => d.id === focusedDealId);
    if (!deal) return null;

    const stageIndex = stages.findIndex(s => s.id === deal.stage);
    const stageDeals = dealsByStage()[deal.stage] || [];
    const dealIndexInStage = stageDeals.findIndex(d => d.id === focusedDealId);

    return { deal, stageIndex, dealIndexInStage, stageDeals };
  }, [focusedDealId, deals, stages, dealsByStage]);

  // Navigate between cards
  const navigateToCard = useCallback((direction) => {
    const info = getFocusedDealInfo();
    if (!info) {
      // No card focused, focus first card in first stage
      const firstStage = stages[0];
      const firstStageDeals = dealsByStage()[firstStage.id] || [];
      if (firstStageDeals.length > 0) {
        setFocusedDealId(firstStageDeals[0].id);
      }
      return;
    }

    const { stageIndex, dealIndexInStage, stageDeals } = info;

    switch (direction) {
      case 'up':
        // Move to previous card in same stage
        if (dealIndexInStage > 0) {
          setFocusedDealId(stageDeals[dealIndexInStage - 1].id);
        }
        break;

      case 'down':
        // Move to next card in same stage
        if (dealIndexInStage < stageDeals.length - 1) {
          setFocusedDealId(stageDeals[dealIndexInStage + 1].id);
        }
        break;

      case 'left':
        // Move to same position in previous stage
        if (stageIndex > 0) {
          const prevStage = stages[stageIndex - 1];
          const prevStageDeals = dealsByStage()[prevStage.id] || [];
          if (prevStageDeals.length > 0) {
            // Move to same index or last card if stage has fewer cards
            const targetIndex = Math.min(dealIndexInStage, prevStageDeals.length - 1);
            setFocusedDealId(prevStageDeals[targetIndex].id);
          }
        }
        break;

      case 'right':
        // Move to same position in next stage
        if (stageIndex < stages.length - 1) {
          const nextStage = stages[stageIndex + 1];
          const nextStageDeals = dealsByStage()[nextStage.id] || [];
          if (nextStageDeals.length > 0) {
            // Move to same index or last card if stage has fewer cards
            const targetIndex = Math.min(dealIndexInStage, nextStageDeals.length - 1);
            setFocusedDealId(nextStageDeals[targetIndex].id);
          }
        }
        break;

      default:
        break;
    }
  }, [getFocusedDealInfo, stages, dealsByStage]);

  // Pick up card for keyboard dragging
  const pickUpCard = useCallback(() => {
    if (focusedDealId && !isDraggingWithKeyboard) {
      setIsDraggingWithKeyboard(true);
      setDraggedDealId(focusedDealId);
      const deal = deals.find(d => d.id === focusedDealId);
      if (deal) {
        setTargetStageId(deal.stage);
      }
    }
  }, [focusedDealId, isDraggingWithKeyboard, deals]);

  // Move card to different stage
  const moveToStage = useCallback((direction) => {
    if (!isDraggingWithKeyboard || !draggedDealId || !targetStageId) return;

    const currentStageIndex = stages.findIndex(s => s.id === targetStageId);
    let newStageIndex = currentStageIndex;

    if (direction === 'left' && currentStageIndex > 0) {
      newStageIndex = currentStageIndex - 1;
    } else if (direction === 'right' && currentStageIndex < stages.length - 1) {
      newStageIndex = currentStageIndex + 1;
    }

    if (newStageIndex !== currentStageIndex) {
      setTargetStageId(stages[newStageIndex].id);
    }
  }, [isDraggingWithKeyboard, draggedDealId, targetStageId, stages]);

  // Drop card at target stage
  const dropCard = useCallback(async () => {
    if (!isDraggingWithKeyboard || !draggedDealId || !targetStageId) return;

    const deal = deals.find(d => d.id === draggedDealId);
    if (deal && deal.stage !== targetStageId && onUpdateDeal) {
      try {
        await onUpdateDeal(deal.id, { stage: targetStageId });
      } catch (error) {
        console.error('Failed to move deal:', error);
      }
    }

    // Reset dragging state
    setIsDraggingWithKeyboard(false);
    setDraggedDealId(null);
    setTargetStageId(null);

    // Keep focus on the moved card
    setFocusedDealId(draggedDealId);
  }, [isDraggingWithKeyboard, draggedDealId, targetStageId, deals, onUpdateDeal]);

  // Cancel keyboard drag
  const cancelDrag = useCallback(() => {
    setIsDraggingWithKeyboard(false);
    setDraggedDealId(null);
    setTargetStageId(null);
  }, []);

  // Global keyboard event handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't handle keyboard events if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      if (!focusedDealId) return;

      if (isDraggingWithKeyboard) {
        // Keyboard dragging mode
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            moveToStage('left');
            break;
          case 'ArrowRight':
            e.preventDefault();
            moveToStage('right');
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            dropCard();
            break;
          case 'Escape':
            e.preventDefault();
            cancelDrag();
            break;
          default:
            break;
        }
      } else {
        // Normal navigation mode
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            navigateToCard('up');
            break;
          case 'ArrowDown':
            e.preventDefault();
            navigateToCard('down');
            break;
          case 'ArrowLeft':
            e.preventDefault();
            navigateToCard('left');
            break;
          case 'ArrowRight':
            e.preventDefault();
            navigateToCard('right');
            break;
          case 'Enter':
            e.preventDefault();
            // Open deal details
            const deal = deals.find(d => d.id === focusedDealId);
            if (deal && onSelectDeal) {
              onSelectDeal(deal);
            }
            break;
          case ' ':
            e.preventDefault();
            pickUpCard();
            break;
          default:
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    focusedDealId,
    isDraggingWithKeyboard,
    navigateToCard,
    pickUpCard,
    moveToStage,
    dropCard,
    cancelDrag,
    deals,
    onSelectDeal
  ]);

  // Focus management - ensure focused element is actually focused
  useEffect(() => {
    if (focusedDealId) {
      const element = document.querySelector(`[data-deal-id="${focusedDealId}"]`);
      if (element && document.activeElement !== element) {
        element.focus();
      }
    }
  }, [focusedDealId]);

  return {
    focusedDealId,
    setFocusedDealId,
    isDraggingWithKeyboard,
    draggedDealId,
    targetStageId,
    pickUpCard,
    dropCard,
    cancelDrag,
  };
}
