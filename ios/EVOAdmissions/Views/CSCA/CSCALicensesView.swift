import SwiftUI

/// Third-party notices of the CSCA screens. SwiftMath (MIT) typesets the
/// formulas with the Latin Modern Math font (GUST Font License); the MIT
/// terms require the notice to ship with the app. Legal texts stay in the
/// original English.
struct CSCALicensesView: View {
    private static let swiftMathNotice = """
    SwiftMath 1.7.3, https://github.com/mgriebling/SwiftMath
    Copyright (c) 2023 Computer Inspirations
    Based on iosMath, Copyright (c) 2013 MathChat

    Permission is hereby granted, free of charge, to any person obtaining a copy \
    of this software and associated documentation files (the "Software"), to deal \
    in the Software without restriction, including without limitation the rights \
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell \
    copies of the Software, and to permit persons to whom the Software is \
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all \
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR \
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, \
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE \
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER \
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, \
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE \
    SOFTWARE.
    """

    private static let fontNotice = """
    Latin Modern Math, GUST e-foundry, distributed under the GUST Font License \
    (LaTeX Project Public License 1.3c). The other math fonts bundled with \
    SwiftMath ship with their license files inside the app bundle.
    """

    var body: some View {
        List {
            Section {
                Text(verbatim: Self.swiftMathNotice)
                    .font(.footnote)
                    .textSelection(.enabled)
            } header: {
                Text(verbatim: "SwiftMath (MIT)")
            }
            Section {
                Text(verbatim: Self.fontNotice)
                    .font(.footnote)
            } header: {
                Text(csca: "csca_licenses_fonts")
            }
        }
        .listStyle(.insetGrouped)
        .environment(\.locale, Locale(identifier: "en"))
        .navigationTitle(Text(csca: "csca_licenses_title"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
