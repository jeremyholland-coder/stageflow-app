import React from 'react';

/**
 * App Context
 * Provides global app state (user, organization, navigation)
 * Extracted to separate file to prevent circular dependencies
 */
const AppContext = React.createContext();

export const useApp = () => {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

export default AppContext;
