"use client"

import { useState } from "react"
import { FileUpload } from "@/components/file-upload"
import { FormatSelector } from "@/components/format-selector"
import { FileList } from "@/components/file-list"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle2, XCircle, Loader2, Download } from "lucide-react"
import JSZip from "jszip"

export default function Home() {
  const [files, setFiles] = useState<File[]>([])
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [isConverting, setIsConverting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState("")
  const [result, setResult] = useState<{ type: "success" | "error"; message: string; details?: any } | null>(null)
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null)
  const [downloadFilename, setDownloadFilename] = useState<string>("")

  const handleFilesSelected = (newFiles: File[]) => {
    setFiles(prev => {
      const existing = new Set(prev.map(f => `${f.name}-${f.size}`))
      const unique = newFiles.filter(f => !existing.has(`${f.name}-${f.size}`))
      return [...prev, ...unique]
    })
  }

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleClearFiles = () => {
    setFiles([])
    setDownloadBlob(null)
    setDownloadFilename("")
    setResult(null)
  }

  const handleDownload = () => {
    if (!downloadBlob) return

    const url = window.URL.createObjectURL(downloadBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = downloadFilename
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  const handleConvert = async () => {
    if (files.length === 0 || selectedFormats.length === 0) return

    setIsConverting(true)
    setProgress(0)
    setProgressText("Preparing conversion...")
    setResult(null)

    try {
      const totalFormats = selectedFormats.length
      const allConvertedFiles: { name: string; blob: Blob }[] = []
      let completedFormats = 0

      for (const format of selectedFormats) {
        const formData = new FormData()
        files.forEach(file => {
          formData.append('fonts', file)
        })
        formData.append('targetFormat', format)

        setProgressText(`Converting... (${format.toUpperCase()}: ${completedFormats + 1}/${totalFormats})`)
        setProgress(10 + (completedFormats / totalFormats) * 80)

        const response = await fetch('/api/convert', {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          const contentType = response.headers.get('content-type')
          let errorMessage = 'Conversion failed'
          
          if (contentType && contentType.includes('application/json')) {
            try {
              const errorData = await response.json()
              errorMessage = errorData.error || errorMessage
            } catch (e) {
              const text = await response.text()
              errorMessage = text || errorMessage
            }
          } else {
            const text = await response.text()
            errorMessage = text || errorMessage
          }
          
          throw new Error(`${format.toUpperCase()} conversion failed: ${errorMessage}`)
        }

        const blob = await response.blob()
        
        if (response.headers.get('content-type') === 'application/zip') {
          const zip = await JSZip.loadAsync(blob)
          
          for (const [filename, file] of Object.entries(zip.files)) {
            if (!file.dir) {
              const fileData = await file.async('blob')
              allConvertedFiles.push({
                name: filename,
                blob: fileData
              })
            }
          }
        } else {
          const contentDisposition = response.headers.get('Content-Disposition')
          const filenameMatch = contentDisposition && contentDisposition.match(/filename="(.+)"/)
          const filename = filenameMatch ? filenameMatch[1] : `converted-font-${Date.now()}.${format}`
          
          allConvertedFiles.push({
            name: filename,
            blob: blob
          })
        }

        completedFormats++
      }

      setProgress(90)
      setProgressText("Compressing files...")

      const finalZip = new JSZip()
      
      for (const file of allConvertedFiles) {
        finalZip.file(file.name, file.blob)
      }

      const finalZipBlob = await finalZip.generateAsync({ type: 'blob' })
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const hours = String(now.getHours()).padStart(2, '0')
      const minutes = String(now.getMinutes()).padStart(2, '0')
      const seconds = String(now.getSeconds()).padStart(2, '0')
      const dateStr = `${year}${month}${day}-${hours}${minutes}${seconds}`
      const finalFilename = `webfont-satang1245-${dateStr}.zip`

      setDownloadBlob(finalZipBlob)
      setDownloadFilename(finalFilename)

      setProgress(100)
      setProgressText("Complete!")
      setResult({
        type: "success",
        message: "Conversion Complete!",
        details: {
          originalFiles: files.length,
          convertedFormats: selectedFormats.map(f => f.toUpperCase()).join(', '),
          convertedFiles: allConvertedFiles.length,
          filename: finalFilename
        }
      })

      setTimeout(() => {
        setProgress(0)
        setProgressText("")
      }, 2000)

    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : 'An unknown error occurred'
      })
      setDownloadBlob(null)
      setDownloadFilename("")
      setProgress(0)
      setProgressText("")
    } finally {
      setIsConverting(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardContent className="p-6 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold">Web font converter</h1>
            <p className="text-muted-foreground">Convert multiple font files at once</p>
          </div>

          <FileUpload onFilesSelected={handleFilesSelected} />

          {files.length > 0 && (
            <FileList
              files={files}
              onRemove={handleRemoveFile}
              onClear={handleClearFiles}
            />
          )}

          <FormatSelector
            selectedFormats={selectedFormats}
            onFormatsChange={setSelectedFormats}
          />

          <Button
            className="w-full"
            onClick={handleConvert}
            disabled={files.length === 0 || selectedFormats.length === 0 || isConverting}
          >
            {isConverting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Converting...
              </>
            ) : (
              "Convert"
            )}
          </Button>

          {(progress > 0 || progressText) && (
            <div className="space-y-2">
              <Progress value={progress} />
              {progressText && (
                <p className="text-sm text-center text-muted-foreground">{progressText}</p>
              )}
            </div>
          )}

          {result && (
            <Alert variant={result.type === "error" ? "destructive" : "default"}>
              <div className="flex items-start gap-3">
                {result.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <AlertTitle>{result.message}</AlertTitle>
                  {result.details && (
                    <AlertDescription className="mt-2 space-y-3">
                      <div className="space-y-1">
                        <p><strong>Original files:</strong> {result.details.originalFiles}</p>
                        <p><strong>Converted formats:</strong> {result.details.convertedFormats}</p>
                        <p><strong>Converted files:</strong> {result.details.convertedFiles}</p>
                        <p><strong>Filename:</strong> {result.details.filename}</p>
                      </div>
                      {downloadBlob && (
                        <Button
                          onClick={handleDownload}
                          className="w-full"
                          size="sm"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download ZIP File
                        </Button>
                      )}
                      <p className="text-xs text-muted-foreground">
                        All files have been compressed into a ZIP file. Click the button above to download.
                      </p>
                    </AlertDescription>
                  )}
                  {result.type === "error" && (
                    <AlertDescription className="mt-2">
                      <p className="text-xs text-muted-foreground">
                        If the problem persists, please check the browser console (F12).
                      </p>
                    </AlertDescription>
                  )}
                </div>
              </div>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
