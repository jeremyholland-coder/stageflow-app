/**
 * Component-Level Error Boundaries for Granular Error Handling
 */
import React from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { ErrorLogger, ERROR_SEVERITY } from '../lib/error-handler';

class BaseErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      errorCount: 0
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    const { componentName, onError } = this.props;
    
    ErrorLogger.log(error, {
      component: componentName || 'Unknown',
      componentStack: errorInfo.componentStack
    });
    
    this.setState(prevState => ({
      error,
      errorInfo,
      errorCount: prevState.errorCount + 1
    }));
    
    if (onError) {
      onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ 
      hasError: false, 
      error: null, 
      errorInfo: null 
    });
    
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.state.errorCount > 2) {
        return this.props.criticalFallback || (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 dark:text-red-100">Critical Error</h3>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  This component has crashed multiple times. Please refresh the page.
                </p>
                <button
                  onClick={() => window.location.reload()}
                  title="Reload the page to recover from this error"
                  className="mt-3 text-sm text-red-600 dark:text-red-400 hover:text-red-700 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reload Page Now
                </button>
              </div>
            </div>
          </div>
        );
      }

      return this.props.fallback || (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900 dark:text-amber-100">
                {this.props.errorTitle || 'Unable to load this section'}
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                {this.props.errorMessage || 'This section failed to load. Click "Try Again" to reload, or refresh the page if the problem persists.'}
              </p>
              {this.props.showDetails && this.state.error && (
                <details className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  <summary className="cursor-pointer hover:text-amber-800">Error Details</summary>
                  <pre className="mt-2 p-2 bg-amber-100 dark:bg-amber-900/40 rounded overflow-auto max-h-32">
                    {this.state.error.toString()}
                  </pre>
                </details>
              )}
              <button
                onClick={this.handleReset}
                title="Retry loading this section"
                className="mt-3 text-sm text-amber-600 dark:text-amber-400 hover:text-amber-700 flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Loading
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function DashboardErrorBoundary({ children }) {
  return (
    <BaseErrorBoundary
      componentName="Dashboard"
      errorTitle="Dashboard Error"
      errorMessage="Unable to load dashboard. Your data is safe."
      showDetails={process.env.NODE_ENV === 'development'}
    >
      {children}
    </BaseErrorBoundary>
  );
}

export function ModalErrorBoundary({ children, onClose }) {
  return (
    <BaseErrorBoundary
      componentName="Modal"
      errorTitle="Modal Error"
      errorMessage="This action could not be completed."
      showDetails={process.env.NODE_ENV === 'development'}
      onReset={onClose}
      fallback={
        <div className="p-6 bg-white dark:bg-[#0D1F2D] rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-[#1A1A1A] dark:text-[#E0E0E0] mb-2">
                Unable to complete action
              </h3>
              <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] mb-4">
                This action couldn't be completed. Close this dialog and try again, or refresh the page if the problem persists.
              </p>
              <button
                onClick={onClose}
                title="Close this dialog and return"
                className="px-4 py-2 bg-[#1ABC9C] hover:bg-[#16A085] text-white rounded-lg transition"
              >
                Close Dialog
              </button>
            </div>
          </div>
        </div>
      }
    >
      {children}
    </BaseErrorBoundary>
  );
}

export function ListErrorBoundary({ children, listName = 'List' }) {
  return (
    <BaseErrorBoundary
      componentName={listName}
      errorTitle={`${listName} Error`}
      errorMessage={`Unable to load ${(listName || 'list').toLowerCase()}. Other features are still available.`}
      showDetails={process.env.NODE_ENV === 'development'}
    >
      {children}
    </BaseErrorBoundary>
  );
}

export function ChartErrorBoundary({ children, chartName = 'Chart' }) {
  return (
    <BaseErrorBoundary
      componentName={chartName}
      fallback={
        <div className="p-8 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-center">
          <AlertTriangle className="w-8 h-8 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Unable to load {(chartName || 'chart').toLowerCase()}
          </p>
        </div>
      }
    >
      {children}
    </BaseErrorBoundary>
  );
}

export class SilentErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    ErrorLogger.log(error, {
      component: this.props.componentName || 'Unknown',
      severity: ERROR_SEVERITY.LOW,
      silent: true
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}

export default BaseErrorBoundary;
