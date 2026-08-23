import React from "react";
import { UploadCloud, FileText, FolderTree, Settings, History, Activity } from "lucide-react";
import { useAuth } from "../context/AuthContext.tsx";

export type NavTab = "upload" | "files" | "folders" | "settings";

interface NavigationProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingCount?: number;
  filesCount?: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  pendingCount = 0,
  filesCount = 0,
}) => {
  const { isAdmin } = useAuth();

  const tabs: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
    badgeColor?: string;
    adminOnly?: boolean;
  }> = [
    {
      id: "upload",
      label: "Unggah Berkas",
      icon: UploadCloud,
    },
    {
      id: "files",
      label: "Daftar Berkas & Status Sync",
      icon: FileText,
      badge: filesCount > 0 ? filesCount : undefined,
    },
    {
      id: "folders",
      label: "Kelola Folder",
      icon: FolderTree,
    },
    {
      id: "settings",
      label: "Pengaturan & Google Drive",
      icon: Settings,
    },
  ];

  return (
    <div className="bg-white border-b border-slate-200 sticky top-16 sm:top-20 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-1 sm:space-x-4 overflow-x-auto py-2.5 no-scrollbar">
          {tabs.map((tab) => {
            if (tab.adminOnly && !isAdmin) return null;
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-transparent"
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? "text-indigo-600" : "text-slate-400"
                  }`}
                />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      isActive
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
