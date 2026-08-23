# Google Drive Integration & Folder Architecture
# Centralized File Upload & Google Drive Synchronization Application

## 1. Google Drive API Integration Principles

1. **System-Managed Identifiers Only**:
   - Google Drive Folder IDs and File IDs are internal technical artifacts.
   - The UI never exposes raw ID text inputs (`Google Drive Folder ID: [______]`).
   - Users and admins interact with visual names, drive pickers, breadcrumb navigation, and tree views.

2. **Drive Discovery (My Drive & Shared Drives)**:
   - Google Drive API v3 queries both personal user space and Google Workspace Shared Drives (`drives.list`).
   - Requests utilize `supportsAllDrives: true` and `includeItemsFromAllDrives: true` across all folder and file API invocations.

---

## 2. Dynamic Folder Tree Construction

### 2.1 Algorithm
1. Retrieve folders using `files.list` with query:
   `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '{parentId}' in parents`
2. Fetch top-level folders (or roots of selected Shared Drive).
3. Transform response into hierarchical JSON tree:
   ```json
   {
     "id": "system_folder_id_xyz",
     "name": "Dokumen",
     "type": "folder",
     "driveType": "SHARED_DRIVE",
     "children": [
       {
         "id": "system_folder_id_abc",
         "name": "Surat",
         "type": "folder",
         "children": []
       }
     ]
   }
   ```
4. On-demand lazy-loading or full recursive caching allows fast, responsive frontend rendering.

---

## 3. Automatic Recursive Folder Creation & Path Resolution

When a destination path is configured (e.g. `2026/Pendataan/KJP` in a designated Shared Drive):

```
Target Path: "2026/Pendataan/KJP"
Segments: ["2026", "Pendataan", "KJP"]

Step 1: Check root of target drive for folder named "2026"
  ├── Found? -> Use existing Folder ID
  └── Not Found? -> files.create(name="2026", parents=[driveRootId]) -> Get new Folder ID

Step 2: Check folder "2026" for child folder named "Pendataan"
  ├── Found? -> Use existing Folder ID
  └── Not Found? -> files.create(name="Pendataan", parents=[id_2026]) -> Get new Folder ID

Step 3: Check folder "Pendataan" for child folder named "KJP"
  ├── Found? -> Use existing Folder ID
  └── Not Found? -> files.create(name="KJP", parents=[id_Pendataan]) -> Get new Folder ID

Result: Destination Folder ID = id_KJP (System-managed & cached in database)
```

### 3.1 Duplicate Protection Strategy
- Before creating any folder segment, query Google Drive:
  `mimeType = 'application/vnd.google-apps.folder' and name = '{segment}' and '{parentId}' in parents and trashed = false`
- If multiple folders with the identical name exist under the parent:
  - Select the oldest non-trashed folder (earliest `createdTime`) and log an activity notice, avoiding random or ambiguous folder duplication.
