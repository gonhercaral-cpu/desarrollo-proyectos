mod audience_window;

use audience_window::{audience_status, show_audience_window};
use regex::Regex;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use zip::ZipArchive;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InternalPresentation {
    id: String,
    title: String,
    source_name: String,
    width: f64,
    height: f64,
    manifest_path: String,
    slides: Vec<InternalSlide>,
    resources: Vec<ImportedMedia>,
    warnings: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InternalSlide {
    id: String,
    number: usize,
    elements: Vec<SlideElement>,
    warnings: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SlideElement {
    Text {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        text: String,
        font_size: f64,
        runs: Vec<TextRun>,
        color: Option<String>,
        background_color: Option<String>,
        text_align: String,
        vertical_align: String,
        z_index: usize,
    },
    Image {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        path: String,
        mime_type: String,
        z_index: usize,
    },
    Media {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        media_kind: String,
        path: Option<String>,
        linked_target: Option<String>,
        z_index: usize,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextRun {
    text: String,
    bold: bool,
    italic: bool,
    color: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedMedia {
    kind: String,
    name: String,
    path: Option<String>,
    linked_target: Option<String>,
    slide_number: usize,
}

#[derive(Clone)]
struct Relationship {
    target: String,
    relation_type: String,
}

#[tauri::command]
fn import_presentation(
    app: tauri::AppHandle,
    path: String,
) -> Result<InternalPresentation, String> {
    let source = PathBuf::from(&path);
    if source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pptx"))
        != Some(true)
    {
        return Err("La primera versión del motor interno admite archivos .pptx".to_string());
    }
    let mut signature = [0_u8; 4];
    File::open(&source)
        .and_then(|mut file| file.read_exact(&mut signature))
        .map_err(|error| format!("No se pudo validar el PPTX: {error}"))?;
    if signature != [0x50, 0x4b, 0x03, 0x04] {
        return Err("El archivo no tiene una firma PPTX/ZIP válida".to_string());
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let id = format!("presentation-{stamp}");
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("presentations")
        .join(&id);
    let assets = root.join("assets");
    fs::create_dir_all(&assets).map_err(|error| error.to_string())?;

    let file = File::open(&source).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| format!("PPTX dañado: {error}"))?;
    let mut warnings = vec!["Primera versión: se convierten cajas de texto e imágenes estáticas; el diseño de temas y formas complejas puede simplificarse.".to_string()];
    let entry_names: Vec<String> = archive.file_names().map(str::to_string).collect();
    if entry_names
        .iter()
        .any(|name| name.contains("vbaProject") || name.starts_with("ppt/activeX/"))
    {
        warnings.push(
            "Se detectaron macros/VBA o ActiveX; se registran pero no se ejecutan por seguridad."
                .to_string(),
        );
    }
    if entry_names
        .iter()
        .any(|name| name.starts_with("ppt/embeddings/"))
    {
        warnings.push(
            "Se detectaron objetos incrustados; se preserva su presencia, pero no se ejecutan."
                .to_string(),
        );
    }

    let (slide_width, slide_height) =
        read_slide_size(&mut archive).unwrap_or((12_192_000.0, 6_858_000.0));
    let mut slide_names: Vec<String> = entry_names
        .into_iter()
        .filter(|name| {
            name.starts_with("ppt/slides/slide")
                && name.ends_with(".xml")
                && !name.contains("/_rels/")
        })
        .collect();
    slide_names.sort_by_key(|name| slide_number(name));
    if slide_names.is_empty() {
        return Err("El PPTX no contiene diapositivas legibles".to_string());
    }

    let mut slides = Vec::new();
    let mut all_media = Vec::new();
    for (index, slide_name) in slide_names.iter().enumerate() {
        let number = index + 1;
        let xml = read_zip_text(&mut archive, slide_name)?;
        let rel_name = format!(
            "ppt/slides/_rels/slide{}.xml.rels",
            slide_number(slide_name)
        );
        let relationships = read_zip_text(&mut archive, &rel_name)
            .ok()
            .map(|xml| parse_relationships(&xml))
            .unwrap_or_default();
        let inherited_shapes = read_inherited_shape_sources(&mut archive, &relationships);
        let (slide, media) = parse_slide(
            &mut archive,
            &assets,
            &xml,
            number,
            slide_width,
            slide_height,
            &relationships,
            &inherited_shapes,
        )?;
        slides.push(slide);
        all_media.extend(media);
    }

    if all_media
        .iter()
        .any(|media| media.kind == "video" || media.kind == "audio")
    {
        warnings.push("Se detectó audio o video. El manifiesto conserva el recurso; controles y reproducción se habilitan cuando el formato sea compatible con WebView.".to_string());
    }
    let title = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Presentación")
        .to_string();
    let manifest_path = root.join("manifest.json");
    let mut manifest = InternalPresentation {
        id,
        title,
        source_name: source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("presentacion.pptx")
            .to_string(),
        width: slide_width,
        height: slide_height,
        manifest_path: manifest_path.to_string_lossy().to_string(),
        slides,
        resources: all_media,
        warnings,
    };
    let json = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    File::create(&manifest_path)
        .and_then(|mut file| file.write_all(&json))
        .map_err(|error| error.to_string())?;
    manifest.manifest_path = manifest_path.to_string_lossy().to_string();
    Ok(manifest)
}

fn read_slide_size(archive: &mut ZipArchive<File>) -> Option<(f64, f64)> {
    let xml = read_zip_text(archive, "ppt/presentation.xml").ok()?;
    let re = Regex::new(r#"<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)""#).ok()?;
    let captures = re.captures(&xml)?;
    Some((captures[1].parse().ok()?, captures[2].parse().ok()?))
}

fn parse_slide(
    archive: &mut ZipArchive<File>,
    assets: &Path,
    xml: &str,
    number: usize,
    sw: f64,
    sh: f64,
    rels: &HashMap<String, Relationship>,
    inherited_shapes: &[String],
) -> Result<(InternalSlide, Vec<ImportedMedia>), String> {
    let mut elements = Vec::new();
    let mut warnings = Vec::new();
    let mut media = Vec::new();
    let shape_block =
        Regex::new(r"(?s)<p:sp(?:\s[^>]*)?>.*?</p:sp>|<p:pic(?:\s[^>]*)?>.*?</p:pic>").unwrap();
    let size_re = Regex::new(r#"sz="(\d+)""#).unwrap();
    let embed_re = Regex::new(r#"r:embed="([^"]+)""#).unwrap();
    for (source_order, block) in shape_block
        .find_iter(xml)
        .map(|value| value.as_str())
        .enumerate()
    {
        if block.starts_with("<p:sp") {
            let color = default_text_color(block);
            let runs = parse_text_runs(block, color.as_deref());
            let text = runs.iter().map(|run| run.text.as_str()).collect::<String>();
            if text.trim().is_empty() {
                continue;
            }
            let (x, y, width, height) = resolved_geometry(block, inherited_shapes, sw, sh);
            let inherited_font_size = placeholder_key(block).and_then(|expected| {
                inherited_shapes.iter().find_map(|source| {
                    find_placeholder_block(source, &expected)
                        .and_then(|candidate| size_re.captures(candidate))
                        .and_then(|capture| capture[1].parse::<f64>().ok())
                })
            });
            let font_size = size_re
                .captures(block)
                .and_then(|capture| capture[1].parse::<f64>().ok())
                .or(inherited_font_size)
                .map(|size| size / 100.0)
                .unwrap_or(24.0);
            elements.push(SlideElement::Text {
                x,
                y,
                width,
                height,
                text,
                font_size,
                runs,
                color,
                background_color: shape_fill_color(block),
                text_align: text_alignment(block),
                vertical_align: vertical_alignment(block),
                z_index: source_order + 1,
            });
        } else {
            let Some(relation_id) = embed_re
                .captures(block)
                .map(|capture| capture[1].to_string())
            else {
                continue;
            };
            let Some(relation) = rels.get(&relation_id) else {
                continue;
            };
            let (x, y, width, height) = geometry(block, sw, sh);
            let archive_path = normalize_ppt_target(&relation.target);
            let file_name = Path::new(&archive_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("image.bin");
            let destination = assets.join(format!("slide-{number}-{file_name}"));
            if copy_zip_entry(archive, &archive_path, &destination).is_ok() {
                let is_background = x <= 1.0 && y <= 1.0 && width >= 98.0 && height >= 98.0;
                elements.push(SlideElement::Image {
                    x,
                    y,
                    width,
                    height,
                    path: destination.to_string_lossy().to_string(),
                    mime_type: mime_for(file_name).to_string(),
                    z_index: if is_background { 0 } else { source_order + 1 },
                });
            }
        }
    }
    for relation in rels.values().filter(|relation| {
        relation.relation_type.contains("video")
            || relation.relation_type.contains("audio")
            || relation.relation_type.ends_with("/media")
    }) {
        let kind = if relation.relation_type.contains("audio")
            || relation.target.to_ascii_lowercase().ends_with(".mp3")
            || relation.target.to_ascii_lowercase().ends_with(".wav")
        {
            "audio"
        } else {
            "video"
        };
        let linked =
            relation.target.starts_with("http://") || relation.target.starts_with("https://");
        let archive_path = normalize_ppt_target(&relation.target);
        let name = Path::new(&relation.target)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(kind)
            .to_string();
        let stored_path = if linked {
            None
        } else {
            let destination = assets.join(format!("slide-{number}-{name}"));
            copy_zip_entry(archive, &archive_path, &destination)
                .ok()
                .map(|_| destination.to_string_lossy().to_string())
        };
        let linked_target = linked.then(|| relation.target.clone());
        media.push(ImportedMedia {
            kind: kind.to_string(),
            name,
            path: stored_path.clone(),
            linked_target: linked_target.clone(),
            slide_number: number,
        });
        elements.push(SlideElement::Media {
            x: 5.0,
            y: 82.0,
            width: 40.0,
            height: 12.0,
            media_kind: kind.to_string(),
            path: stored_path,
            linked_target,
            z_index: elements.len() + 1,
        });
    }
    if xml.contains("<p:timing") {
        warnings.push(
            "Animaciones o secuencias detectadas: no se reproducen en esta versión.".to_string(),
        );
    }
    if xml.contains("<p:transition") {
        warnings.push(
            "Transición avanzada detectada: se usa cambio directo de diapositiva.".to_string(),
        );
    }
    if xml.contains("<p:graphicFrame") {
        warnings.push(
            "Gráfico, tabla o SmartArt detectado: puede no representarse todavía.".to_string(),
        );
    }
    Ok((
        InternalSlide {
            id: format!("slide-{number}"),
            number,
            elements,
            warnings,
        },
        media,
    ))
}

fn parse_text_runs(block: &str, default_color: Option<&str>) -> Vec<TextRun> {
    let paragraph_re = Regex::new(r"(?s)<a:p(?:\s[^>]*)?>.*?</a:p>").unwrap();
    let run_re =
        Regex::new(r"(?s)<a:r(?:\s[^>]*)?>.*?</a:r>|<a:fld(?:\s[^>]*)?>.*?</a:fld>").unwrap();
    let text_re = Regex::new(r"(?s)<a:t>(.*?)</a:t>").unwrap();
    let property_re = Regex::new(r#"<a:rPr\b([^>]*)"#).unwrap();
    let mut runs = Vec::new();

    for (paragraph_index, paragraph) in paragraph_re
        .find_iter(block)
        .map(|value| value.as_str())
        .enumerate()
    {
        if paragraph_index > 0 {
            runs.push(TextRun {
                text: "\n".to_string(),
                bold: false,
                italic: false,
                color: default_color.map(str::to_string),
            });
        }
        let before = runs.len();
        for run in run_re.find_iter(paragraph).map(|value| value.as_str()) {
            let text = text_re
                .captures_iter(run)
                .map(|capture| xml_unescape(&capture[1]))
                .collect::<String>();
            if text.is_empty() {
                continue;
            }
            let attributes = property_re
                .captures(run)
                .map(|capture| capture[1].to_string())
                .unwrap_or_default();
            runs.push(TextRun {
                text,
                bold: attributes.contains("b=\"1\"") || attributes.contains("b=\"true\""),
                italic: attributes.contains("i=\"1\"") || attributes.contains("i=\"true\""),
                color: color_from_xml(run).or_else(|| default_color.map(str::to_string)),
            });
        }
        if runs.len() == before {
            let text = text_re
                .captures_iter(paragraph)
                .map(|capture| xml_unescape(&capture[1]))
                .collect::<String>();
            if !text.is_empty() {
                runs.push(TextRun {
                    text,
                    bold: false,
                    italic: false,
                    color: default_color.map(str::to_string),
                });
            }
        }
    }

    if runs.is_empty() {
        let text = text_re
            .captures_iter(block)
            .map(|capture| xml_unescape(&capture[1]))
            .collect::<String>();
        if !text.is_empty() {
            runs.push(TextRun {
                text,
                bold: false,
                italic: false,
                color: default_color.map(str::to_string),
            });
        }
    }
    runs
}

fn color_from_xml(xml: &str) -> Option<String> {
    let rgb = Regex::new(r#"<a:srgbClr[^>]*val="([0-9A-Fa-f]{6})""#)
        .unwrap()
        .captures(xml)
        .map(|capture| format!("#{}", capture[1].to_ascii_uppercase()));
    if rgb.is_some() {
        return rgb;
    }
    let scheme = Regex::new(r#"<a:schemeClr[^>]*val="([^"]+)""#)
        .unwrap()
        .captures(xml)
        .map(|capture| capture[1].to_string())?;
    match scheme.as_str() {
        "tx1" | "dk1" => Some("#000000".to_string()),
        "lt1" | "bg1" => Some("#FFFFFF".to_string()),
        _ => None,
    }
}

fn shape_fill_color(block: &str) -> Option<String> {
    let properties = Regex::new(r"(?s)<p:spPr(?:\s[^>]*)?>.*?</p:spPr>")
        .unwrap()
        .find(block)?
        .as_str();
    let solid_fill = Regex::new(r"(?s)<a:solidFill(?:\s[^>]*)?>.*?</a:solidFill>")
        .unwrap()
        .find(properties)?
        .as_str();
    color_from_xml(solid_fill)
}

fn default_text_color(block: &str) -> Option<String> {
    let font_reference = Regex::new(r"(?s)<a:fontRef(?:\s[^>]*)?>.*?</a:fontRef>")
        .unwrap()
        .find(block)
        .map(|value| value.as_str());
    font_reference.and_then(color_from_xml)
}

fn text_alignment(block: &str) -> String {
    let alignment = Regex::new(r#"<a:pPr[^>]*algn="([^"]+)""#)
        .unwrap()
        .captures(block)
        .map(|capture| capture[1].to_string());
    match alignment.as_deref() {
        Some("ctr") => "center",
        Some("r") => "right",
        Some("just") | Some("dist") => "justify",
        _ => "left",
    }
    .to_string()
}

fn vertical_alignment(block: &str) -> String {
    let anchor = Regex::new(r#"<a:bodyPr[^>]*anchor="([^"]+)""#)
        .unwrap()
        .captures(block)
        .map(|capture| capture[1].to_string());
    match anchor.as_deref() {
        Some("ctr") => "center",
        Some("b") => "end",
        _ => "start",
    }
    .to_string()
}

fn read_inherited_shape_sources(
    archive: &mut ZipArchive<File>,
    rels: &HashMap<String, Relationship>,
) -> Vec<String> {
    let Some(layout_relation) = rels
        .values()
        .find(|relationship| relationship.relation_type.ends_with("/slideLayout"))
    else {
        return Vec::new();
    };
    let layout_path = normalize_ppt_target(&layout_relation.target);
    let Ok(layout_xml) = read_zip_text(archive, &layout_path) else {
        return Vec::new();
    };
    let mut sources = vec![layout_xml];
    let relationship_path = relationship_part_path(&layout_path);
    let Ok(layout_rels_xml) = read_zip_text(archive, &relationship_path) else {
        return sources;
    };
    let layout_rels = parse_relationships(&layout_rels_xml);
    if let Some(master_relation) = layout_rels
        .values()
        .find(|relationship| relationship.relation_type.ends_with("/slideMaster"))
    {
        if let Ok(master_xml) =
            read_zip_text(archive, &normalize_ppt_target(&master_relation.target))
        {
            sources.push(master_xml);
        }
    }
    sources
}

fn relationship_part_path(part_path: &str) -> String {
    let path = Path::new(part_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    format!("{}/_rels/{}.rels", parent.to_string_lossy(), file_name)
}

fn placeholder_key(block: &str) -> Option<(Option<String>, Option<String>)> {
    let placeholder = Regex::new(r#"<p:ph\b([^>]*)/?>"#)
        .unwrap()
        .captures(block)?;
    let attributes = &placeholder[1];
    let type_re = Regex::new(r#"type="([^"]+)""#).unwrap();
    let index_re = Regex::new(r#"idx="([^"]+)""#).unwrap();
    Some((
        type_re
            .captures(attributes)
            .map(|capture| capture[1].to_string()),
        index_re
            .captures(attributes)
            .map(|capture| capture[1].to_string()),
    ))
}

fn placeholder_matches(
    candidate: &(Option<String>, Option<String>),
    expected: &(Option<String>, Option<String>),
) -> bool {
    if candidate.1.is_some() && candidate.1 == expected.1 {
        return true;
    }
    match (&candidate.0, &expected.0) {
        (Some(left), Some(right)) => {
            left == right
                || matches!(
                    (left.as_str(), right.as_str()),
                    ("title", "ctrTitle") | ("ctrTitle", "title")
                )
        }
        _ => false,
    }
}

fn find_placeholder_block<'a>(
    source: &'a str,
    expected: &(Option<String>, Option<String>),
) -> Option<&'a str> {
    let shape_re = Regex::new(r"(?s)<p:sp(?:\s[^>]*)?>.*?</p:sp>").unwrap();
    let matched = shape_re
        .find_iter(source)
        .map(|candidate| candidate.as_str())
        .find(|candidate| {
            placeholder_key(candidate)
                .as_ref()
                .is_some_and(|key| placeholder_matches(key, expected))
        });
    matched
}

fn geometry_if_present(block: &str, sw: f64, sh: f64) -> Option<(f64, f64, f64, f64)> {
    let off = Regex::new(r#"<a:off[^>]*x="(-?\d+)"[^>]*y="(-?\d+)""#).unwrap();
    let ext = Regex::new(r#"<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)""#).unwrap();
    let offset = off.captures(block)?;
    let extent = ext.captures(block)?;
    let x = offset[1].parse::<f64>().ok()?;
    let y = offset[2].parse::<f64>().ok()?;
    let width = extent[1].parse::<f64>().ok()?;
    let height = extent[2].parse::<f64>().ok()?;
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some((
        x / sw * 100.0,
        y / sh * 100.0,
        width / sw * 100.0,
        height / sh * 100.0,
    ))
}

fn resolved_geometry(
    block: &str,
    inherited_shapes: &[String],
    sw: f64,
    sh: f64,
) -> (f64, f64, f64, f64) {
    if let Some(geometry) = geometry_if_present(block, sw, sh) {
        return geometry;
    }
    if let Some(expected) = placeholder_key(block) {
        for source in inherited_shapes {
            if let Some(geometry) = find_placeholder_block(source, &expected)
                .and_then(|candidate| geometry_if_present(candidate, sw, sh))
            {
                return geometry;
            }
        }
    }
    let placeholder_type = placeholder_key(block).and_then(|key| key.0);
    match placeholder_type.as_deref() {
        Some("title") | Some("ctrTitle") => (5.0, 4.0, 90.0, 18.0),
        Some("subTitle") => (10.0, 58.0, 80.0, 24.0),
        _ => (5.0, 23.0, 90.0, 68.0),
    }
}

fn parse_relationships(xml: &str) -> HashMap<String, Relationship> {
    let tag_re = Regex::new(r#"<Relationship\s+([^>]+)/?>"#).unwrap();
    let attr_re = Regex::new(r#"([A-Za-z]+)="([^"]*)""#).unwrap();
    tag_re
        .captures_iter(xml)
        .filter_map(|tag| {
            let attrs: HashMap<String, String> = attr_re
                .captures_iter(&tag[1])
                .map(|capture| (capture[1].to_string(), capture[2].to_string()))
                .collect();
            Some((
                attrs.get("Id")?.clone(),
                Relationship {
                    target: attrs.get("Target")?.clone(),
                    relation_type: attrs.get("Type").cloned().unwrap_or_default(),
                },
            ))
        })
        .collect()
}

fn geometry(block: &str, sw: f64, sh: f64) -> (f64, f64, f64, f64) {
    geometry_if_present(block, sw, sh).unwrap_or((0.0, 0.0, 100.0, 100.0))
}

fn read_zip_text(archive: &mut ZipArchive<File>, name: &str) -> Result<String, String> {
    let mut value = String::new();
    archive
        .by_name(name)
        .map_err(|error| error.to_string())?
        .read_to_string(&mut value)
        .map_err(|error| error.to_string())?;
    Ok(value)
}

fn copy_zip_entry(
    archive: &mut ZipArchive<File>,
    name: &str,
    destination: &Path,
) -> Result<(), String> {
    let mut source = archive.by_name(name).map_err(|error| error.to_string())?;
    let mut output = File::create(destination).map_err(|error| error.to_string())?;
    std::io::copy(&mut source, &mut output).map_err(|error| error.to_string())?;
    Ok(())
}

fn normalize_ppt_target(target: &str) -> String {
    if target.starts_with('/') {
        target.trim_start_matches('/').to_string()
    } else {
        format!("ppt/{}", target.trim_start_matches("../"))
    }
}
fn slide_number(name: &str) -> usize {
    Regex::new(r"slide(\d+)\.xml")
        .unwrap()
        .captures(name)
        .and_then(|capture| capture[1].parse().ok())
        .unwrap_or(0)
}
fn xml_unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}
fn mime_for(name: &str) -> &'static str {
    match Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_real_pptx_text_into_internal_slide_elements() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/internal-import-sample.pptx");
        let file = File::open(fixture).expect("fixture PPTX");
        let mut archive = ZipArchive::new(file).expect("valid PPTX zip");
        let (width, height) = read_slide_size(&mut archive).expect("slide size");
        let xml = read_zip_text(&mut archive, "ppt/slides/slide1.xml").expect("slide xml");
        let relationships = read_zip_text(&mut archive, "ppt/slides/_rels/slide1.xml.rels")
            .ok()
            .map(|value| parse_relationships(&value))
            .unwrap_or_default();
        let assets = std::env::temp_dir().join("active-classroom-import-test-assets");
        fs::create_dir_all(&assets).expect("test assets directory");
        let inherited_shapes = read_inherited_shape_sources(&mut archive, &relationships);
        let (slide, _) = parse_slide(
            &mut archive,
            &assets,
            &xml,
            1,
            width,
            height,
            &relationships,
            &inherited_shapes,
        )
        .expect("converted slide");
        let imported_text = slide
            .elements
            .iter()
            .filter_map(|element| match element {
                SlideElement::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" ");
        assert!(imported_text.contains("Prueba Active Classroom"));
        assert!(imported_text.contains("Importación PPTX funcional"));
        let text_bounds = slide
            .elements
            .iter()
            .filter_map(|element| match element {
                SlideElement::Text {
                    x,
                    y,
                    width,
                    height,
                    ..
                } => Some((*x, *y, *width, *height)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(text_bounds.len(), 2);
        assert_ne!(
            text_bounds[0], text_bounds[1],
            "inherited placeholders must not overlap as full-slide boxes"
        );
        assert!(text_bounds
            .iter()
            .all(|(_, _, width, height)| *width < 100.0 && *height < 100.0));
    }

    #[test]
    fn converts_text_and_image_fixture_without_dropping_text() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/text-image-navigation.pptx");
        let file = File::open(fixture).expect("text and image fixture PPTX");
        let mut archive = ZipArchive::new(file).expect("valid text and image PPTX zip");
        let (width, height) = read_slide_size(&mut archive).expect("slide size");
        let xml = read_zip_text(&mut archive, "ppt/slides/slide1.xml").expect("slide xml");
        let relationships = read_zip_text(&mut archive, "ppt/slides/_rels/slide1.xml.rels")
            .ok()
            .map(|value| parse_relationships(&value))
            .unwrap_or_default();
        let assets = std::env::temp_dir().join("active-classroom-text-image-test-assets");
        fs::create_dir_all(&assets).expect("test assets directory");
        let inherited_shapes = read_inherited_shape_sources(&mut archive, &relationships);
        let (slide, _) = parse_slide(
            &mut archive,
            &assets,
            &xml,
            1,
            width,
            height,
            &relationships,
            &inherited_shapes,
        )
        .expect("converted slide");
        let imported_text = slide
            .elements
            .iter()
            .filter_map(|element| match element {
                SlideElement::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" ");
        assert!(imported_text.contains("Texto e imagen deben conservarse"));
        assert!(imported_text.contains("Active Classroom convierte el texto editable"));
        assert!(
            slide
                .elements
                .iter()
                .any(|element| matches!(element, SlideElement::Image { .. })),
            "embedded image must be extracted"
        );
    }

    #[test]
    fn validates_real_slide_eleven_when_source_is_available() {
        let Ok(source) = std::env::var("ACTIVE_CLASSROOM_REAL_PPTX") else {
            return;
        };
        let file = File::open(source).expect("real PPTX");
        let mut archive = ZipArchive::new(file).expect("valid real PPTX zip");
        let (width, height) = read_slide_size(&mut archive).expect("real slide size");
        let xml = read_zip_text(&mut archive, "ppt/slides/slide11.xml").expect("slide 11 xml");
        let relationships = read_zip_text(&mut archive, "ppt/slides/_rels/slide11.xml.rels")
            .ok()
            .map(|value| parse_relationships(&value))
            .unwrap_or_default();
        let assets = std::env::temp_dir().join("active-classroom-real-slide-11-assets");
        fs::create_dir_all(&assets).expect("real slide assets directory");
        let inherited_shapes = read_inherited_shape_sources(&mut archive, &relationships);
        let (slide, _) = parse_slide(
            &mut archive,
            &assets,
            &xml,
            11,
            width,
            height,
            &relationships,
            &inherited_shapes,
        )
        .expect("converted real slide 11");

        assert!(matches!(
            slide.elements.first(),
            Some(SlideElement::Image { z_index: 0, .. })
        ));
        let question = slide.elements.iter().find(|element| {
            matches!(element, SlideElement::Text { text, .. } if text == "Preguntas “WH” y “si” y “no” con verbo “to be”.")
        });
        let Some(SlideElement::Text {
            background_color,
            runs,
            z_index,
            ..
        }) = question
        else {
            panic!("rich text sentence must remain one line of runs");
        };
        assert_eq!(background_color.as_deref(), Some("#FF5252"));
        assert!(runs.iter().any(|run| run.bold && run.italic));
        assert!(*z_index > 0, "text must render above full-slide background");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let audience = app
                .get_webview_window("audience")
                .ok_or_else(|| "No se encontró la ventana del alumnado".to_string())?;
            if audience
                .available_monitors()
                .map_err(|error| error.to_string())?
                .len()
                > 1
            {
                show_audience_window(app.handle().clone())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_audience_window,
            audience_status,
            import_presentation
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar Active Classroom");
}
