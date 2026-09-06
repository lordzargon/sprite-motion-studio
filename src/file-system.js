// Web File System Access API wrapper
// Enables native OS "Save As..." and "Open..." file dialogs on Windows/Mac/Linux
// with seamless fallback for environments that do not support it.

export class NativeFileSystem {
  /**
   * Prompts user with native OS "Save As" dialog to pick folder and filename,
   * then writes the content directly.
   * @param {Blob|string} content - Data to save
   * @param {string} suggestedName - Default filename
   * @param {Array<{description: string, accept: Record<string, string[]>}>} types - File filters
   * @returns {Promise<{success: boolean, cancelled?: boolean, filename?: string}>}
   */
  static async saveFile(content, suggestedName, types = []) {
    if ('showSaveFilePicker' in window) {
      try {
        const pickerOptions = {
          suggestedName: suggestedName
        };
        if (types && types.length > 0) {
          pickerOptions.types = types;
        }

        const fileHandle = await window.showSaveFilePicker(pickerOptions);
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        return { success: true, filename: fileHandle.name };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { success: false, cancelled: true };
        }
        console.warn('Native showSaveFilePicker failed, falling back to download:', err);
      }
    }

    // Fallback: trigger browser download
    NativeFileSystem.downloadFallback(content, suggestedName);
    return { success: true, filename: suggestedName, fallback: true };
  }

  /**
   * Prompts user with native OS "Open File" dialog to pick a file.
   * @param {Array<{description: string, accept: Record<string, string[]>}>} types
   * @returns {Promise<File|null>}
   */
  static async openFile(types = []) {
    if ('showOpenFilePicker' in window) {
      try {
        const pickerOptions = {
          multiple: false
        };
        if (types && types.length > 0) {
          pickerOptions.types = types;
        }
        const [fileHandle] = await window.showOpenFilePicker(pickerOptions);
        if (fileHandle) {
          return await fileHandle.getFile();
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          return null; // User cancelled
        }
        console.warn('Native showOpenFilePicker failed, falling back to input:', err);
      }
    }

    // Fallback using hidden input element
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (types && types.length > 0) {
        const extensions = [];
        types.forEach(t => {
          Object.values(t.accept || {}).forEach(exts => extensions.push(...exts));
        });
        input.accept = extensions.join(',');
      }
      input.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        resolve(file || null);
      };
      input.click();
    });
  }

  /**
   * Traditional <a> download fallback
   */
  static downloadFallback(blobOrString, filename) {
    const link = document.createElement('a');
    let blobUrl = null;

    if (typeof blobOrString === 'string') {
      const blob = new Blob([blobOrString], { type: 'application/json' });
      blobUrl = URL.createObjectURL(blob);
      link.href = blobUrl;
    } else if (blobOrString instanceof Blob) {
      blobUrl = URL.createObjectURL(blobOrString);
      link.href = blobUrl;
    } else {
      link.href = blobOrString;
    }

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (blobUrl) {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }
  }
}
