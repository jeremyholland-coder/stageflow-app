import React, { useState } from 'react';
import { X, GripVertical, Save } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Sortable Stage Item
 * Individual stage card in the reorder list
 */
const SortableStageItem = ({ stage }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Get stage icon component
  const StageIcon = stage.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 p-4 bg-gray-800/30 rounded-xl
        border-2 border-gray-700
        ${isDragging ? 'shadow-2xl shadow-teal-500/20 z-50 border-teal-500' : 'shadow-sm'}
        transition-all duration-200 hover:border-teal-500/50
      `}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-2 -m-2 hover:bg-gray-800/50 rounded-lg transition touch-manipulation"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-5 h-5 text-gray-500" />
      </button>

      {/* Stage Icon */}
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center ring-2 ring-gray-700"
        style={{ backgroundColor: `${stage.color}20` }}
      >
        {StageIcon && <StageIcon className="w-5 h-5" style={{ color: stage.color }} />}
      </div>

      {/* Stage Name */}
      <div className="flex-1">
        <h4 className="font-semibold text-white">
          {stage.name}
        </h4>
      </div>

      {/* Visual indicator that it's draggable */}
      <div className="text-xs text-gray-500 font-medium hidden sm:block">
        Drag to reorder
      </div>
    </div>
  );
};

/**
 * Reorder Stages Modal
 *
 * Allows users to reorder pipeline stages via drag-and-drop
 * Mobile-friendly with touch support
 */
export const ReorderStagesModal = ({ isOpen, onClose, stages, onSave }) => {
  const [orderedStages, setOrderedStages] = useState(stages);
  const [isSaving, setIsSaving] = useState(false);

  // Configure drag sensors with Apple-level precision
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts (prevents accidental drags)
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 100, // 100ms hold before drag starts on touch
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setOrderedStages((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const newOrderIds = orderedStages.map(s => s.id);
      await onSave(newOrderIds);
      onClose();
    } catch (error) {
      console.error('Error saving stage order:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset to original order
    setOrderedStages(stages);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/95 backdrop-blur-sm z-[60] animate-in fade-in duration-200"
        onClick={handleCancel}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4">
        <div
          className="bg-gradient-to-br from-gray-900 to-black border border-teal-500/30 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-700">
            <div>
              <h2 className="text-xl font-bold text-white">
                Reorder Pipeline Stages
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                Drag stages to change their order in your pipeline
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-gray-800/50 rounded-lg transition text-gray-400 hover:text-white"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Stage List */}
          <div className="flex-1 overflow-y-auto p-6">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedStages.map(s => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {orderedStages.map((stage) => (
                    <SortableStageItem key={stage.id} stage={stage} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-700">
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="px-6 py-3 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-xl transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              title={isSaving ? "Saving changes..." : "Save stage order"}
              className="px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-semibold flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving Stage Order...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
