import puppeteer from "puppeteer";
import xlsx from "xlsx";
import fs from "fs";

const CATEGORY_URL = "https://www.jomashop.com/watches.html";
const PAGE_URL = "https://www.jomashop.com";

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100; // Khoảng cách cuộn mỗi lần
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100); // Thời gian chờ giữa mỗi lần cuộn
    });
  });
}

async function GTranslate(searchQuery) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  // console.log(`Đang dịch: ${searchQuery}`);

  try {
    // Tạo URL bằng encodeURIComponent để đảm bảo độ chính xác
    const translateUrl = `https://translate.google.com/?sl=en&tl=vi&text=${encodeURIComponent(
      searchQuery,
    )}&op=translate`;

    // Điều hướng tới Google Translate
    await page.goto(translateUrl, { waitUntil: "domcontentloaded" });

    // Chờ các phần tử kết quả dịch xuất hiện
    await page.waitForSelector(".ryNqvb", { timeout: 10000 });

    // Lấy toàn bộ văn bản đã dịch
    const result = await page.evaluate(() => {
      const translationElements = document.querySelectorAll(".ryNqvb");
      return Array.from(translationElements)
        .map((el) => el.innerText.trim())
        .join(" "); // Ghép lại thành một đoạn văn đầy đủ
    });

    // console.log(`Kết quả dịch: ${result}`);
    return result || "Không thể dịch";
  } catch (error) {
    console.error("Lỗi khi dịch văn bản:", error);
    return "Lỗi khi dịch";
  } finally {
    await browser.close();
  }
}

async function scrapeData() {
  const browser = await puppeteer.launch({ headless: true }); // Hiển thị trình duyệt
  const page = await browser.newPage();
  await page.goto(CATEGORY_URL, { waitUntil: "networkidle2" });

  // Duyệt qua từng link sản phẩm để crawl thông tin chi tiết
  let products = [];
  let currentPageUrl = CATEGORY_URL;
  let hasNextPage = true;

  while (hasNextPage && products.length < 500) {
    // Lấy danh sách link sản phẩm từ trang danh mục
    const productLinks = await page.evaluate(() => {
      const productElements = document.querySelectorAll(".productItemBlock");

      return [...productElements].map((product) => product.getAttribute("data-scroll-target"));
    });

    console.log(`Tìm thấy ${productLinks.length} sản phẩm.`);

    for (let i = 0; i < productLinks.length; i++) {
      try {
        const productUrl = PAGE_URL + productLinks[i];
        console.log(`Đang crawl sản phẩm ${i + 1}/${productLinks.length}: ${productUrl}`);

        const productPage = await browser.newPage();
        await productPage.goto(productUrl, { waitUntil: "networkidle2" });
        await autoScroll(productPage);

        const description = await productPage.evaluate(() => {
          const descElement = document.querySelector(".show-more-text-content");
          return descElement ? descElement.innerText : "Không có mô tả";
        });

        // Dịch description sang tiếng Việt
        const translatedDescription = await GTranslate(description);

        const product = await productPage.evaluate(
          (url, translatedDescription) => {
            const productInfo = document.querySelector(".product-info-main");

            function extractNumbers(inputString) {
              if (!inputString) return null;
              const numbers = inputString.match(/\d+/g);
              return numbers ? numbers.join("") : "";
            }

            const name = productInfo?.querySelector(".product-name")?.innerText || "Không có tên sản phẩm";
            const brand = productInfo.querySelector(".brand-name")?.innerText.trim() || "Không có dữ liệu thương hiệu";
            const price = extractNumbers(productInfo?.querySelector(".now-price")?.innerText) || "Không có giá";
            const salePrice =
              extractNumbers(productInfo?.querySelector(".was-wrapper")?.innerText) || "Không có giá sale";
            const rating =
              extractNumbers(document.querySelector(".yotpo-display-wrapper a")?.innerText) || "Không có đánh giá";
            const avgRating =
              document.querySelector(".avg-score.font-color-gray-darker")?.innerText || "Không có đánh giá trung bình";
            const images = [...document.querySelectorAll(".thumbs-items-wrapper.simple-slider-wrapper img")]
              .map((img) => img.getAttribute("src"))
              .join(", ");

            const additionalInfo = document.querySelectorAll(".more-detail-Row");
            let sku = null;

            additionalInfo.forEach((row) => {
              const header = row.querySelector("h3");
              if (header && header.textContent.trim() === "Additional Info") {
                // Tìm phần tử chứa "Jomashop Sku"
                const skuRow = Array.from(row.querySelectorAll(".more-detail-content")).find((content) => {
                  const label = content.querySelector("h4");
                  return label && label.textContent.trim() === "Jomashop Sku";
                });

                if (skuRow) {
                  sku = skuRow.querySelector(".more-value")?.textContent.trim();
                }
              }
            });

            return {
              name,
              brand,
              sku,
              description: translatedDescription,
              price,
              salePrice,
              rating,
              avgRating,
              images,
              url,
            };
          },
          productUrl,
          translatedDescription,
        );

        products.push(product);

        // Lặp qua từng phần tử con của .more-detail-body
        await productPage.close();
      } catch (error) {
        console.error(`Lỗi khi crawl sản phẩm: `, error);
      }
    }

    // Kiểm tra và chuyển sang trang tiếp theo nếu có
    try {
      const nextPageUrl = await page.evaluate(() => {
        const nextButton = document.querySelector(".pagination-next.page-item a.page-link");
        return nextButton ? nextButton.getAttribute("href") : null;
      });

      if (nextPageUrl) {
        currentPageUrl = PAGE_URL + nextPageUrl;
        await page.goto(currentPageUrl, { waitUntil: "networkidle2" });
      } else {
        hasNextPage = false; // Không còn trang tiếp theo
      }
    } catch (error) {
      console.error("Lỗi khi chuyển trang:", error);
      hasNextPage = false;
    }
  }
  await browser.close();
  return products;
}

async function exportToExcel(data) {
  const worksheet = xlsx.utils.json_to_sheet(data);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Danh sách sản phẩm");
  const filePath = "./JomaWatches.xlsx";
  xlsx.writeFile(workbook, filePath);
  console.log(`Dữ liệu đã được xuất ra file ${filePath}`);
}

(async () => {
  try {
    const data = await scrapeData();
    await exportToExcel(data);
  } catch (error) {
    console.error("Lỗi trong quá trình crawl dữ liệu:", error);
  }
})();
