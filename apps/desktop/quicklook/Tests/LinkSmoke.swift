import CoreGraphics
import Foundation
#if !HOP_PREVIEW
import ImageIO
#endif

/// Run after dead stripping and symbol removal, before signing the extensions.
@main
enum LinkSmoke {
    static func main() throws {
        #if HOP_PREVIEW
        let principalClass = "HopQuickLookPreview.HwpPreviewProvider"
        #else
        let principalClass = "HopQuickLookThumbnail.HwpThumbnailProvider"
        #endif
        precondition(NSClassFromString(principalClass) != nil, "Quick Look principal class removed")
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let result = data.withUnsafeBytes { raw -> HopQuickLookRenderResult in
            let ptr = raw.bindMemory(to: UInt8.self).baseAddress
            #if HOP_PREVIEW
            return hop_ql_render_preview_pdf(ptr, data.count)
            #else
            return hop_ql_render_first_page_png(ptr, data.count, 512)
            #endif
        }
        precondition(result.status == HopQuickLookStatus.ok.rawValue, "Quick Look render failed")
        precondition(result.page_count > 0 && result.width > 0 && result.height > 0)
        let output = try hopQuickLookData(from: result.bytes)
        #if HOP_PREVIEW
        let provider = CGDataProvider(data: output as CFData)!
        let pdf = CGPDFDocument(provider)!
        precondition(pdf.numberOfPages == Int(result.page_count))
        #else
        let source = CGImageSourceCreateWithData(output as CFData, nil)!
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
        precondition(image.width > 0 && image.height > 0)
        precondition(max(image.width, image.height) <= 512)
        #endif
        print("Quick Look optimized link smoke passed: \(principalClass)")
    }
}
